use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

use crate::files;

/// Built-in plugins ship with the app and must not be shadowed by imported ones.
const BUILTIN_IDS: [&str; 2] = ["pomodoro", "water"];

/// Keep this list in sync with `src/plugins/types.ts`.
const PERMISSIONS: [&str; 4] = ["pet.say", "pet.state", "pet.read", "config.read"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub permissions: Vec<String>,
    pub entry: String,
    pub builtin: bool,
    /// Absolute directory of imported plugins. `None` for built-in plugins.
    pub dir: Option<String>,
}

fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve config dir: {err}"))?
        .join("plugins");
    fs::create_dir_all(&dir).map_err(|err| format!("cannot create plugins dir: {err}"))?;
    Ok(dir)
}

/// A plugin entry must stay inside its folder and be an HTML document.
fn valid_entry(entry: &str) -> bool {
    let path = Path::new(entry);
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("html"))
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn plugin_info_from(meta: &Value, dir: Option<&Path>) -> Option<PluginInfo> {
    if meta.get("schema").and_then(Value::as_u64) != Some(1) {
        return None;
    }

    let id = files::string_field(meta, "id")?;
    if !files::valid_id(&id) {
        return None;
    }
    let name = files::string_field(meta, "name")?;
    if name.trim().is_empty() {
        return None;
    }

    let entry = files::string_field(meta, "entry").unwrap_or_else(|| "plugin.html".to_string());
    if !valid_entry(&entry) {
        return None;
    }

    let mut permissions = Vec::new();
    if let Some(list) = meta.get("permissions") {
        let list = list.as_array()?;
        for item in list {
            let permission = item.as_str()?;
            if !PERMISSIONS.contains(&permission) {
                return None;
            }
            if !permissions.iter().any(|known| known == permission) {
                permissions.push(permission.to_string());
            }
        }
    }

    Some(PluginInfo {
        schema: 1,
        id,
        name,
        version: files::string_field(meta, "version").unwrap_or_else(|| "0.0.0".to_string()),
        description: files::string_field(meta, "description"),
        author: files::string_field(meta, "author"),
        permissions,
        entry,
        builtin: dir.is_none(),
        dir: dir.map(|path| path.to_string_lossy().to_string()),
    })
}

fn plugin_info(dir: &Path) -> Option<PluginInfo> {
    let meta = files::read_json(&dir.join("plugin.json"))?;
    plugin_info_from(&meta, Some(dir))
}

#[tauri::command]
pub fn list_plugins(app: tauri::AppHandle) -> Result<Vec<PluginInfo>, String> {
    let dir = plugins_dir(&app)?;
    let mut plugins = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|err| format!("cannot read plugins dir: {err}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if let Some(info) = plugin_info(&path) {
            if !BUILTIN_IDS.contains(&info.id.as_str()) {
                plugins.push(info);
            }
        }
    }

    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(plugins)
}

#[tauri::command]
pub fn import_plugin(app: tauri::AppHandle, zip_path: String) -> Result<PluginInfo, String> {
    let source = PathBuf::from(&zip_path);
    if !source.is_file() {
        return Err("找不到要导入的压缩包".to_string());
    }

    let plugins = plugins_dir(&app)?;
    let temp = plugins.join(format!(
        ".import-{}-{}",
        std::process::id(),
        files::timestamp_millis()
    ));
    fs::create_dir_all(&temp).map_err(|err| format!("cannot create temp dir: {err}"))?;

    let result = (|| {
        files::extract_zip(&source, &temp)?;

        let root = files::find_manifest_root(
            &temp,
            "plugin.json",
            "压缩包里有多个插件，请一次只放一个",
        )?;
        let meta = files::read_json(&root.join("plugin.json"))
            .ok_or_else(|| "plugin.json 不是有效的 JSON".to_string())?;
        let info = plugin_info_from(&meta, None)
            .ok_or_else(|| "plugin.json 缺少合法的 schema / id / name / entry".to_string())?;

        if BUILTIN_IDS.contains(&info.id.as_str()) {
            return Err("不能覆盖内置插件的 id".to_string());
        }
        if !root.join(&info.entry).is_file() {
            return Err(format!("插件入口文件不存在：{}", info.entry));
        }

        let target = plugins.join(&info.id);
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|err| format!("cannot replace existing plugin: {err}"))?;
        }

        if root == temp {
            fs::rename(&temp, &target).map_err(|err| format!("cannot install plugin: {err}"))?;
        } else {
            fs::rename(&root, &target).map_err(|err| format!("cannot install plugin: {err}"))?;
        }

        plugin_info(&target).ok_or_else(|| "安装后的插件无法读取".to_string())
    })();

    if temp.exists() {
        let _ = fs::remove_dir_all(&temp);
    }
    result
}

#[tauri::command]
pub fn remove_plugin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !files::valid_id(&id) {
        return Err("非法的插件 id".to_string());
    }
    if BUILTIN_IDS.contains(&id.as_str()) {
        return Err("内置插件不能删除".to_string());
    }
    let dir = plugins_dir(&app)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|err| format!("cannot remove plugin: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_plugin_file(
    app: tauri::AppHandle,
    id: String,
    file: String,
) -> Result<String, String> {
    if !files::valid_id(&id) {
        return Err("非法的插件 id".to_string());
    }
    files::read_file_base64(
        &plugins_dir(&app)?.join(&id),
        &file,
        "插件不存在",
        &format!("插件里没有 {file}"),
    )
}
