use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::Value;

/// Shared limits for everything the app unpacks from a user supplied archive.
pub const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ARCHIVE_ENTRIES: usize = 512;
pub const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// Pet packs and plugins both use lower-case ids that are safe as directory names.
pub fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    chars.all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

/// Reads JSON, tolerating the UTF-8 BOM that some Windows archivers add.
pub fn read_json(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    serde_json::from_str(raw).ok()
}

pub fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

pub fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Splits a relative file reference into a safe path below a pack/plugin directory.
pub fn safe_relative(file: &str) -> Option<PathBuf> {
    let path = Path::new(file);
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return None;
    }
    Some(path.to_path_buf())
}

/// Reads a file below `dir` and returns it base64-encoded, refusing escapes via `..`.
pub fn read_file_base64(
    dir: &Path,
    file: &str,
    missing_dir: &str,
    missing_file: &str,
) -> Result<String, String> {
    let relative = safe_relative(file).ok_or_else(|| "非法的文件名".to_string())?;
    let canonical_dir = dir.canonicalize().map_err(|_| missing_dir.to_string())?;
    let canonical = dir
        .join(relative)
        .canonicalize()
        .map_err(|_| missing_file.to_string())?;
    if !canonical.starts_with(&canonical_dir) {
        return Err("非法的文件路径".to_string());
    }

    let meta = fs::metadata(&canonical).map_err(|err| format!("cannot stat file: {err}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("文件超过 32 MB 限制".to_string());
    }

    let bytes = fs::read(&canonical).map_err(|err| format!("cannot read file: {err}"))?;
    Ok(BASE64.encode(bytes))
}

/// Extracts a zip into `temp`, enforcing entry-count, total-size and path limits.
pub fn extract_zip(zip_path: &Path, temp: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|err| format!("cannot open zip: {err}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|err| format!("invalid zip: {err}"))?;

    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!("压缩包文件太多（最多 {MAX_ARCHIVE_ENTRIES} 个）"));
    }

    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("cannot read zip entry: {err}"))?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        total = total.saturating_add(entry.size());
        if total > MAX_ARCHIVE_BYTES {
            return Err("压缩包解压后超过 64 MB 限制".to_string());
        }

        let target = temp.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("cannot create directory: {err}"))?;
        }
        let mut out = fs::File::create(&target).map_err(|err| format!("cannot write file: {err}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|err| format!("cannot extract file: {err}"))?;
    }

    Ok(())
}

/// Finds the folder that holds `manifest`, either at the archive root or in its only folder.
pub fn find_manifest_root(temp: &Path, manifest: &str, multiple: &str) -> Result<PathBuf, String> {
    if temp.join(manifest).is_file() {
        return Ok(temp.to_path_buf());
    }

    let mut roots = Vec::new();
    if let Ok(entries) = fs::read_dir(temp) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join(manifest).is_file() {
                roots.push(path);
            }
        }
    }

    match roots.len() {
        1 => Ok(roots.remove(0)),
        0 => Err(format!("压缩包里没有找到 {manifest}")),
        _ => Err(multiple.to_string()),
    }
}

/// Writes a pretty-printed JSON document, creating parent directories as needed.
pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("cannot create directory: {err}"))?;
    }
    let raw = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    let mut file = fs::File::create(path).map_err(|err| format!("cannot write file: {err}"))?;
    file.write_all(raw.as_bytes())
        .map_err(|err| format!("cannot write file: {err}"))
}
