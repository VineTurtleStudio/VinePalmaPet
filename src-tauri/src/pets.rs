use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;

const BUILTIN_ID: &str = "vine";
const MAX_PACK_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PACK_ENTRIES: usize = 512;
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_GIF_FRAMES: usize = 60;
const MAX_ATLAS_WIDTH: u32 = 16_000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PetPackInfo {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub license: Option<String>,
    pub description: Option<String>,
    pub builtin: bool,
    /// Absolute directory of imported packs. `None` for the built-in pack.
    pub dir: Option<String>,
}

fn pets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("cannot resolve config dir: {err}"))?
        .join("pets");
    fs::create_dir_all(&dir).map_err(|err| format!("cannot create pets dir: {err}"))?;
    Ok(dir)
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    serde_json::from_str(raw).ok()
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn is_pet_pack(meta: &Value) -> bool {
    meta.get("schema").and_then(Value::as_u64) == Some(1)
        && meta.get("id").and_then(Value::as_str).is_some_and(valid_id)
        && meta
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|name| !name.trim().is_empty())
}

fn pack_info(dir: &Path) -> Option<PetPackInfo> {
    let meta = read_json(&dir.join("pet.json"))?;
    if !is_pet_pack(&meta) {
        return None;
    }
    Some(PetPackInfo {
        id: string_field(&meta, "id")?,
        name: string_field(&meta, "name")?,
        author: string_field(&meta, "author"),
        license: string_field(&meta, "license"),
        description: string_field(&meta, "description"),
        builtin: false,
        dir: Some(dir.to_string_lossy().to_string()),
    })
}

fn builtin_pack() -> PetPackInfo {
    PetPackInfo {
        id: BUILTIN_ID.to_string(),
        name: "Vine".to_string(),
        author: Some("VineTurtleStudio".to_string()),
        license: Some("CC-BY-4.0".to_string()),
        description: Some("内置的占位藤芽角色".to_string()),
        builtin: true,
        dir: None,
    }
}

#[tauri::command]
pub fn list_pet_packs(app: tauri::AppHandle) -> Result<Vec<PetPackInfo>, String> {
    let dir = pets_dir(&app)?;
    let mut packs = vec![builtin_pack()];

    let entries = fs::read_dir(&dir).map_err(|err| format!("cannot read pets dir: {err}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if let Some(info) = pack_info(&path) {
            packs.push(info);
        }
    }

    packs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(packs)
}

fn unique_id(dir: &Path, base: &str) -> String {
    if !dir.join(base).exists() {
        return base.to_string();
    }
    for suffix in 2..1000 {
        let candidate = format!("{base}-{suffix}");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{base}-{}", timestamp_millis())
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn find_pack_root(temp: &Path) -> Result<PathBuf, String> {
    if temp.join("pet.json").is_file() {
        return Ok(temp.to_path_buf());
    }

    let mut roots = Vec::new();
    if let Ok(entries) = fs::read_dir(temp) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("pet.json").is_file() {
                roots.push(path);
            }
        }
    }

    match roots.len() {
        1 => Ok(roots.remove(0)),
        0 => Err("压缩包里没有找到 pet.json".to_string()),
        _ => Err("压缩包里有多个宠物包，请一次只放一个".to_string()),
    }
}

#[tauri::command]
pub fn import_pet_pack(app: tauri::AppHandle, zip_path: String) -> Result<PetPackInfo, String> {
    let source = PathBuf::from(&zip_path);
    if !source.is_file() {
        return Err("找不到要导入的压缩包".to_string());
    }

    let pets = pets_dir(&app)?;
    let temp = pets.join(format!(".import-{}-{}", std::process::id(), timestamp_millis()));
    fs::create_dir_all(&temp).map_err(|err| format!("cannot create temp dir: {err}"))?;

    let result = (|| {
        let file = fs::File::open(&source).map_err(|err| format!("cannot open zip: {err}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|err| format!("invalid zip: {err}"))?;

        if archive.len() > MAX_PACK_ENTRIES {
            return Err(format!("压缩包文件太多（最多 {MAX_PACK_ENTRIES} 个）"));
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
            if total > MAX_PACK_BYTES {
                return Err("压缩包解压后超过 64 MB 限制".to_string());
            }
            let target = temp.join(&relative);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("cannot create pack dir: {err}"))?;
            }
            let mut out =
                fs::File::create(&target).map_err(|err| format!("cannot write file: {err}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|err| format!("cannot extract file: {err}"))?;
        }

        let root = find_pack_root(&temp)?;
        let meta = read_json(&root.join("pet.json"))
            .ok_or_else(|| "pet.json 不是有效的 JSON".to_string())?;
        if !is_pet_pack(&meta) {
            return Err("pet.json 缺少合法的 schema / id / name".to_string());
        }
        let id = string_field(&meta, "id").unwrap_or_default();

        let target = pets.join(&id);
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|err| format!("cannot replace existing pack: {err}"))?;
        }

        if root == temp {
            fs::rename(&temp, &target).map_err(|err| format!("cannot install pack: {err}"))?;
        } else {
            fs::rename(&root, &target).map_err(|err| format!("cannot install pack: {err}"))?;
        }

        pack_info(&target).ok_or_else(|| "安装后的宠物包无法读取".to_string())
    })();

    if temp.exists() {
        let _ = fs::remove_dir_all(&temp);
    }
    result
}

#[tauri::command]
pub fn remove_pet_pack(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("非法的宠物包 id".to_string());
    }
    if id == BUILTIN_ID {
        return Err("内置宠物包不能删除".to_string());
    }
    let dir = pets_dir(&app)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|err| format!("cannot remove pack: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_pet_file(app: tauri::AppHandle, id: String, file: String) -> Result<String, String> {
    if !valid_id(&id) {
        return Err("非法的宠物包 id".to_string());
    }

    let relative = Path::new(&file);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("非法的文件名".to_string());
    }

    let dir = pets_dir(&app)?.join(&id);
    let canonical_dir = dir
        .canonicalize()
        .map_err(|_| "宠物包不存在".to_string())?;
    let path = dir.join(relative);
    let canonical = path
        .canonicalize()
        .map_err(|_| format!("宠物包里没有 {file}"))?;
    if !canonical.starts_with(&canonical_dir) {
        return Err("非法的文件路径".to_string());
    }

    let meta = fs::metadata(&canonical).map_err(|err| format!("cannot stat file: {err}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("宠物包文件超过 32 MB 限制".to_string());
    }

    let bytes = fs::read(&canonical).map_err(|err| format!("cannot read file: {err}"))?;
    Ok(BASE64.encode(bytes))
}

fn clear_rect(canvas: &mut [u8], width: u32, x: u32, y: u32, w: u32, h: u32) {
    for row in y..(y + h).min(canvas.len() as u32 / (width.max(1) * 4)) {
        let start = ((row * width + x) * 4) as usize;
        let end = start + (w * 4) as usize;
        if end <= canvas.len() {
            canvas[start..end].fill(0);
        }
    }
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-').to_string();
    slug.chars().take(24).collect()
}

#[tauri::command]
pub fn import_gif_pack(
    app: tauri::AppHandle,
    gif_path: String,
    name: Option<String>,
) -> Result<PetPackInfo, String> {
    let source = PathBuf::from(&gif_path);
    if !source.is_file() {
        return Err("找不到要导入的 GIF".to_string());
    }

    let file = fs::File::open(&source).map_err(|err| format!("cannot open gif: {err}"))?;
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options
        .read_info(file)
        .map_err(|err| format!("invalid gif: {err}"))?;

    let width = decoder.width() as u32;
    let height = decoder.height() as u32;
    if width == 0 || height == 0 {
        return Err("GIF 尺寸无效".to_string());
    }
    if width > 1024 || height > 1024 {
        return Err("GIF 尺寸不能超过 1024×1024".to_string());
    }

    // Fit the GIF into the 256px design budget. Small sprites are upscaled (up to 4x)
    // so a 64px GIF still reads as a desktop pet instead of a tiny dot.
    let scale = (256.0 / width.max(height) as f64).min(4.0);
    let frame_w = ((width as f64 * scale).round() as u32).max(1);
    let frame_h = ((height as f64 * scale).round() as u32).max(1);
    let max_frames = ((MAX_ATLAS_WIDTH / frame_w).max(1) as usize).min(MAX_GIF_FRAMES);

    let mut canvas = vec![0u8; (width * height * 4) as usize];
    let mut frames: Vec<Vec<u8>> = Vec::new();
    let mut delays: Vec<u16> = Vec::new();
    let mut previous: Option<(u32, u32, u32, u32, gif::DisposalMethod, Option<Vec<u8>>)> = None;

    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|err| format!("cannot decode gif frame: {err}"))?
    {
        if frames.len() >= max_frames {
            break;
        }

        if let Some((px, py, pw, ph, dispose, saved)) = previous.take() {
            match dispose {
                gif::DisposalMethod::Background => clear_rect(&mut canvas, width, px, py, pw, ph),
                gif::DisposalMethod::Previous => {
                    if let Some(saved) = saved {
                        canvas.copy_from_slice(&saved);
                    }
                }
                _ => {}
            }
        }

        let saved = if frame.dispose == gif::DisposalMethod::Previous {
            Some(canvas.clone())
        } else {
            None
        };

        let fw = frame.width as u32;
        let fh = frame.height as u32;
        let left = frame.left as u32;
        let top = frame.top as u32;
        for y in 0..fh {
            for x in 0..fw {
                let source_index = ((y * fw + x) * 4) as usize;
                if frame.buffer[source_index + 3] == 0 {
                    continue;
                }
                let dx = left + x;
                let dy = top + y;
                if dx >= width || dy >= height {
                    continue;
                }
                let target_index = ((dy * width + dx) * 4) as usize;
                canvas[target_index..target_index + 4]
                    .copy_from_slice(&frame.buffer[source_index..source_index + 4]);
            }
        }

        frames.push(canvas.clone());
        delays.push(frame.delay);
        previous = Some((left, top, fw, fh, frame.dispose, saved));
    }

    if frames.is_empty() {
        return Err("GIF 里没有可用的帧".to_string());
    }

    let usable_delays: Vec<u16> = delays.iter().copied().filter(|delay| *delay > 0).collect();
    let average_delay = if usable_delays.is_empty() {
        8.0
    } else {
        usable_delays.iter().map(|delay| *delay as f64).sum::<f64>() / usable_delays.len() as f64
    };
    let fps = (100.0 / average_delay).clamp(2.0, 30.0);

    let mut atlas = image::RgbaImage::new(frame_w * frames.len() as u32, frame_h);
    for (index, frame) in frames.iter().enumerate() {
        let source = image::RgbaImage::from_raw(width, height, frame.clone())
            .ok_or_else(|| "GIF 帧数据无效".to_string())?;
        let resized =
            image::imageops::resize(&source, frame_w, frame_h, image::imageops::FilterType::Triangle);
        image::imageops::overlay(&mut atlas, &resized, (index as u32 * frame_w) as i64, 0);
    }

    let display_name = name
        .unwrap_or_else(|| {
            source
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "GIF Pet".to_string())
        })
        .trim()
        .to_string();
    let display_name = if display_name.is_empty() {
        "GIF Pet".to_string()
    } else {
        display_name
    };

    let pets = pets_dir(&app)?;
    let slug = slugify(&display_name);
    let base_id = if slug.is_empty() {
        format!("gif-{}", timestamp_millis())
    } else {
        format!("gif-{slug}")
    };
    let id = unique_id(&pets, &base_id);
    let target = pets.join(&id);
    fs::create_dir_all(&target).map_err(|err| format!("cannot create pack dir: {err}"))?;

    atlas
        .save_with_format(target.join("anim.png"), image::ImageFormat::Png)
        .map_err(|err| format!("cannot write atlas: {err}"))?;

    let meta = json!({
        "schema": 1,
        "id": id,
        "name": display_name,
        "author": "Imported from GIF",
        "license": "Unknown",
        "description": "从 GIF 导入的宠物包",
        "frame": { "width": frame_w, "height": frame_h },
        "anchor": { "x": 0.5, "y": 1.0 },
        "bubble": { "x": 0.5, "y": 0.06 },
        "animations": {
            "anim": {
                "file": "anim.png",
                "frames": frames.len(),
                "fps": (fps * 100.0).round() / 100.0,
                "loop": false
            }
        },
        "states": {
            "idle": { "anims": ["anim"], "loop": true, "priority": 0 },
            "pat": { "anims": ["anim"], "next": "idle", "priority": 30 },
            "celebrate": { "anims": ["anim"], "next": "idle", "priority": 40 },
            "focus": { "anims": ["anim"], "loop": true, "priority": 10 },
            "sleep": { "anims": ["anim"], "loop": true, "priority": 20 },
            "talk": { "anims": ["anim"], "loop": true, "priority": 15 }
        }
    });

    let raw = serde_json::to_string_pretty(&meta).map_err(|err| err.to_string())?;
    let mut meta_file =
        fs::File::create(target.join("pet.json")).map_err(|err| format!("cannot write pet.json: {err}"))?;
    meta_file
        .write_all(raw.as_bytes())
        .map_err(|err| format!("cannot write pet.json: {err}"))?;

    pack_info(&target).ok_or_else(|| "生成的宠物包无法读取".to_string())
}
