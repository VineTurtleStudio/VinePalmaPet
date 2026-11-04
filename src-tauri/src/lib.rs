use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{
    menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

mod pets;

struct PetMenu(Menu<tauri::Wry>);

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
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }
    let raw = fs::read_to_string(&path).map_err(|err| format!("cannot read config: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("invalid config json: {err}"))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: Value) -> Result<(), String> {
    let path = config_path(&app)?;
    let raw = serde_json::to_string_pretty(&config).map_err(|err| err.to_string())?;
    fs::write(&path, raw).map_err(|err| format!("cannot write config: {err}"))
}

/// Merges top-level keys into the persisted config. Used by both windows so that,
/// for example, saving the window position cannot clobber a setting written by
/// the settings window a moment earlier.
#[tauri::command]
fn patch_config(app: tauri::AppHandle, patch: Value) -> Result<Value, String> {
    let path = config_path(&app)?;
    let mut current = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|err| format!("cannot read config: {err}"))?;
        let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
        serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::Object(Default::default()))
    } else {
        Value::Object(Default::default())
    };

    if !current.is_object() {
        current = Value::Object(Default::default());
    }
    if let (Some(target), Some(source)) = (current.as_object_mut(), patch.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }

    let raw = serde_json::to_string_pretty(&current).map_err(|err| err.to_string())?;
    fs::write(&path, raw).map_err(|err| format!("cannot write config: {err}"))?;
    Ok(current)
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
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            patch_config,
            quit_app,
            open_settings,
            show_pet_menu,
            pets::list_pet_packs,
            pets::import_pet_pack,
            pets::remove_pet_pack,
            pets::read_pet_file,
            pets::import_gif_pack
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
