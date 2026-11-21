use std::fs;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_note, write_note])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
