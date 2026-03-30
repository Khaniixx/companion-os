#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::net::{SocketAddr, TcpStream};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::RECT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
};

const RUNTIME_HOST: &str = "127.0.0.1";
const RUNTIME_PORT: u16 = 8000;
const RUNTIME_BOOT_WAIT_ATTEMPTS: usize = 40;
const RUNTIME_BOOT_WAIT_MS: u64 = 250;

#[derive(Serialize)]
struct ActiveWindowBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    title: String,
}

fn runtime_socket_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], RUNTIME_PORT))
}

fn runtime_is_available() -> bool {
    TcpStream::connect_timeout(&runtime_socket_addr(), Duration::from_millis(200)).is_ok()
}

fn runtime_data_dir(app: &tauri::App) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not determine app data directory: {error}"))
}

fn runtime_executable_path(app: &tauri::App) -> Result<Option<PathBuf>, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [
            resource_dir.join("companion-runtime.exe"),
            resource_dir.join("binaries").join("companion-runtime.exe"),
        ] {
            if candidate.exists() {
                return Ok(Some(candidate));
            }
        }
    }

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            for candidate in [
                exe_dir.join("companion-runtime.exe"),
                exe_dir.join("binaries").join("companion-runtime.exe"),
            ] {
                if candidate.exists() {
                    return Ok(Some(candidate));
                }
            }
        }
    }

    if cfg!(debug_assertions) {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .map(|path| path.to_path_buf())
            .ok_or_else(|| "Could not resolve repo root".to_string())?;

        let dev_runtime = repo_root
            .join("services")
            .join("agent-runtime")
            .join(".venv")
            .join("Scripts")
            .join("python.exe");
        if dev_runtime.exists() {
            return Ok(Some(dev_runtime));
        }
    }

    Ok(None)
}

fn spawn_runtime(app: &tauri::App) -> Result<(), String> {
    if runtime_is_available() {
        return Ok(());
    }

    let runtime_executable = runtime_executable_path(app)?
        .ok_or_else(|| "Could not find the local runtime binary".to_string())?;
    let runtime_data_dir = runtime_data_dir(app)?;
    fs::create_dir_all(&runtime_data_dir)
        .map_err(|error| format!("Could not create runtime data directory: {error}"))?;

    let mut command = Command::new(&runtime_executable);
    command
        .env("COMPANION_RUNTIME_DATA_DIR", &runtime_data_dir)
        .env("COMPANION_RUNTIME_HOST", RUNTIME_HOST)
        .env("COMPANION_RUNTIME_PORT", RUNTIME_PORT.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if runtime_executable
        .file_name()
        .and_then(|value| value.to_str())
        == Some("python.exe")
    {
        command
            .current_dir(
                runtime_executable
                    .parent()
                    .and_then(|path| path.parent())
                    .and_then(|path| path.parent())
                    .ok_or_else(|| "Could not resolve development runtime directory".to_string())?,
            )
            .arg("-m")
            .arg("uvicorn")
            .arg("app.main:app")
            .arg("--host")
            .arg(RUNTIME_HOST)
            .arg("--port")
            .arg(RUNTIME_PORT.to_string())
            .arg("--log-level")
            .arg("warning");
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("Could not launch the local runtime: {error}"))?;

    for _ in 0..RUNTIME_BOOT_WAIT_ATTEMPTS {
        if runtime_is_available() {
            return Ok(());
        }
        sleep(Duration::from_millis(RUNTIME_BOOT_WAIT_MS));
    }

    Err("The local runtime did not start in time.".to_string())
}

#[tauri::command]
fn active_window_bounds() -> Option<ActiveWindowBounds> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() || !unsafe { IsWindowVisible(hwnd).as_bool() } {
            return None;
        }

        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
            return None;
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return None;
        }

        let title_len = unsafe { GetWindowTextLengthW(hwnd) };
        let mut title_buffer = vec![0u16; title_len as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut title_buffer) };
        let title = String::from_utf16_lossy(&title_buffer[..copied as usize]);

        return Some(ActiveWindowBounds {
            x: rect.left,
            y: rect.top,
            width,
            height,
            title,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            spawn_runtime(app).map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![active_window_bounds])
        .run(tauri::generate_context!())
        .expect("error while running Companion OS desktop");
}
