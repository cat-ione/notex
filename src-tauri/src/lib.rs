use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// Read a note file chosen by the user through a native dialog.
#[tauri::command]
fn read_note(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("could not read {path}: {e}"))
}

/// Write a note atomically: write a sibling temp file, then rename over the target,
/// so a crash mid-write never leaves a truncated note behind.
#[tauri::command]
fn write_note(path: String, contents: String) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("could not write {path}: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("could not save {path}: {e}"))
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

/// The user's config file contents, or None on first run.
#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = config_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    write_note(config_file(&app)?.to_string_lossy().into_owned(), contents)
}

/// Open the config file in the user's default editor.
#[tauri::command]
fn open_config(app: tauri::AppHandle) -> Result<String, String> {
    let path = config_file(&app)?;
    let shown = path.to_string_lossy().into_owned();
    app.opener()
        .open_path(shown.clone(), None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(shown)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_note,
            write_note,
            load_config,
            save_config,
            open_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
