use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{
    menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

mod files;
mod pets;
mod plugins;

struct PetMenu(Menu<tauri::Wry>);

/// Serializes read-modify-write cycles so two windows cannot overwrite each
/// other's changes while both are updating the config.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn lock_config() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CONFIG_LOCK
        .lock()
        .map_err(|_| "config lock is poisoned".to_string())
}

fn read_config_value(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("cannot read config: {err}"))?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    Ok(serde_json::from_str(raw).unwrap_or_else(|_| Value::Object(Default::default())))
}

fn write_config_value(path: &Path, value: &Value) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| format!("cannot write config: {err}"))
}

/// Makes sure `plugins.enabled` and `plugins.data` exist and have the right shape.
fn ensure_plugins(root: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !root.is_object() {
        *root = serde_json::json!({});
    }
    let object = root.as_object_mut().expect("root is an object");

    let plugins = object
        .entry("plugins")
        .or_insert_with(|| serde_json::json!({}));
    if !plugins.is_object() {
        *plugins = serde_json::json!({});
    }
    let plugins = plugins.as_object_mut().expect("plugins is an object");

    if !plugins.get("enabled").is_some_and(Value::is_array) {
        plugins.insert("enabled".into(), serde_json::json!([]));
    }
    if !plugins.get("data").is_some_and(Value::is_object) {
        plugins.insert("data".into(), serde_json::json!({}));
    }
    plugins
}

/// Location of the persisted app config:
/// `%APPDATA%\com.vineturtle.vinepalmapet\config.json`
fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve config dir: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("cannot create config dir: {err}"))?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<Value, String> {
    let path = config_path(&app)?;
    let _guard = lock_config()?;
    read_config_value(&path)
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let path = config_path(&app)?;
    let _guard = lock_config()?;
    write_config_value(&path, &config)
}

/// Merges top-level keys into the persisted config. Used by both windows so that,
/// for example, saving the window position cannot clobber a setting written by
/// the settings window a moment earlier.
#[tauri::command]
fn patch_config(app: tauri::AppHandle, patch: Value) -> Result<Value, String> {
    let path = config_path(&app)?;
    let _guard = lock_config()?;

    let mut current = read_config_value(&path)?;
    if !current.is_object() {
        current = Value::Object(Default::default());
    }
    if let (Some(target), Some(source)) = (current.as_object_mut(), patch.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }

    write_config_value(&path, &current)?;
    Ok(current)
}

/// Toggles one plugin without replacing the rest of `plugins`, so a delayed
/// storage write from the pet window cannot undo a settings change.
#[tauri::command]
fn set_plugin_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> Result<Value, String> {
    if !files::valid_id(&id) {
        return Err("非法的插件 id".to_string());
    }

    let path = config_path(&app)?;
    let _guard = lock_config()?;
    let mut root = read_config_value(&path)?;
    let plugins = ensure_plugins(&mut root);
    let list = plugins
        .get_mut("enabled")
        .and_then(Value::as_array_mut)
        .expect("enabled is an array");
    list.retain(|item| item.as_str() != Some(id.as_str()));

    if enabled {
        if list.len() >= 64 {
            return Err("最多同时启用 64 个插件".to_string());
        }
        list.push(Value::String(id));
    }

    write_config_value(&path, &root)?;
    Ok(root["plugins"].clone())
}

/// Writes a single key of one plugin's storage. Storage is always allowed and
/// does not touch the enabled list.
#[tauri::command]
fn set_plugin_storage(
    app: tauri::AppHandle,
    plugin_id: String,
    key: String,
    value: Value,
) -> Result<Value, String> {
    if !files::valid_id(&plugin_id) {
        return Err("非法的插件 id".to_string());
    }
    if key.is_empty() || key.len() > 64 {
        return Err("存储键不合法".to_string());
    }
    match &value {
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
        Value::String(text) if text.encode_utf16().count() <= 2000 => {}
        _ => return Err("只支持 string / number / boolean / null".to_string()),
    }

    let path = config_path(&app)?;
    let _guard = lock_config()?;
    let mut root = read_config_value(&path)?;
    let plugins = ensure_plugins(&mut root);
    let data = plugins
        .get_mut("data")
        .and_then(Value::as_object_mut)
        .expect("data is an object");

    let store = data
        .entry(plugin_id)
        .or_insert_with(|| serde_json::json!({}));
    if !store.is_object() {
        *store = serde_json::json!({});
    }
    let store = store.as_object_mut().expect("plugin storage is an object");
    if value.is_null() {
        store.remove(&key);
    } else {
        store.insert(key, value);
    }
    if store.len() > 64 {
        return Err("插件的存储键太多了".to_string());
    }

    write_config_value(&path, &root)?;
    Ok(root["plugins"].clone())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Shows (or focuses) the settings window and asks it to re-read the config.
fn show_settings_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("settings://refresh", ());
    }
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    show_settings_window(&app);
}

/// Pops the native context menu at the current cursor position.
#[tauri::command]
fn show_pet_menu(app: tauri::AppHandle, menu: tauri::State<'_, PetMenu>) -> Result<(), String> {
    let webview = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let window = webview.as_ref().window();
    menu.0.popup(window).map_err(|err| err.to_string())
}

fn toggle_pet_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("pet") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            patch_config,
            set_plugin_enabled,
            set_plugin_storage,
            quit_app,
            open_settings,
            show_pet_menu,
            pets::list_pet_packs,
            pets::import_pet_pack,
            pets::remove_pet_pack,
            pets::read_pet_file,
            pets::import_gif_pack,
            plugins::list_plugins,
            plugins::import_plugin,
            plugins::remove_plugin,
            plugins::read_plugin_file
        ])
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "pet:settings" {
                show_settings_window(app);
                return;
            }
            println!("[menu] {id}");
            if let Some(action) = id.strip_prefix("pet:") {
                let _ = app.emit_to("pet", "pet://action", action.to_string());
            }
        })
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset", "回到默认位置", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 VinePalmaPet", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &toggle,
                    &reset,
                    &settings,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;

            // Native context menu for the pet itself.
            let pet_pat = MenuItem::with_id(app, "pet:pat", "摸摸头", true, None::<&str>)?;
            let pet_focus = MenuItem::with_id(app, "pet:focus", "专注模式 / 结束专注", true, None::<&str>)?;
            let pet_sleep = MenuItem::with_id(app, "pet:sleep", "睡一会儿", true, None::<&str>)?;
            let pet_talk = MenuItem::with_id(app, "pet:talk", "说句话", true, None::<&str>)?;
            let pet_scale_down = MenuItem::with_id(app, "pet:scale-down", "缩小", true, None::<&str>)?;
            let pet_scale_up = MenuItem::with_id(app, "pet:scale-up", "放大", true, None::<&str>)?;
            let pet_top = MenuItem::with_id(app, "pet:toggle-top", "切换窗口置顶", true, None::<&str>)?;
            let pet_reset = MenuItem::with_id(app, "pet:reset", "回到默认位置", true, None::<&str>)?;
            let pet_settings = MenuItem::with_id(app, "pet:settings", "设置…", true, None::<&str>)?;
            let pet_quit = MenuItem::with_id(app, "pet:quit", "退出 VinePalmaPet", true, None::<&str>)?;

            let pet_menu = Menu::with_items(
                app,
                &[
                    &pet_pat,
                    &pet_focus,
                    &pet_sleep,
                    &pet_talk,
                    &PredefinedMenuItem::separator(app)?,
                    &pet_scale_down,
                    &pet_scale_up,
                    &pet_top,
                    &pet_reset,
                    &PredefinedMenuItem::separator(app)?,
                    &pet_settings,
                    &pet_quit,
                ],
            )?;
            app.manage(PetMenu(pet_menu));

            let mut builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("VinePalmaPet")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_pet_window(app),
                    "reset" => {
                        if let Some(window) = app.get_webview_window("pet") {
                            let _ = window.emit("pet://reset-position", ());
                        }
                    }
                    "settings" => show_settings_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("pet") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }

            builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep the pet alive in the tray when its window is closed.
            if window.label() == "pet" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running VinePalmaPet");
}
