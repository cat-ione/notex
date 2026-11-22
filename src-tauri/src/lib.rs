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

/// A bare Alt press and release (often the tail of another app's Alt+… shortcut) puts a
/// Windows window into keyboard menu mode, even with no menu bar: keys then go to the
/// invisible menu until Esc. The window turns that request down. (Alt+Space still opens
/// the window menu, and Alt+key shortcuts reach the page as before.)
#[cfg(windows)]
mod alt_menu {
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SC_KEYMENU, WM_SYSCOMMAND};

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
        // menu mode from the keyboard with no key named (lparam 0): bare Alt
        if msg == WM_SYSCOMMAND && (wparam as u32 & 0xFFF0) == SC_KEYMENU && lparam == 0 {
            return 0;
        }
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    pub fn install(hwnd: HWND) {
        unsafe {
            SetWindowSubclass(hwnd, Some(proc), 1, 0);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(windows)]
            if let Some(w) = _app.get_webview_window("main") {
                if let Ok(hwnd) = w.hwnd() {
                    alt_menu::install(hwnd.0 as _);
                }
            }
            Ok(())
        })
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
