use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent, Emitter,
};

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

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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
        .invoke_handler(tauri::generate_handler![load_config, save_config, quit_app])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset", "回到默认位置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 VinePalmaPet", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &toggle,
                    &reset,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?;

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
            // Keep the pet alive in the tray when the window is closed.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running VinePalmaPet");
}
