use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "windows")]
fn ensure_runtime_resource_placeholder() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let runtime_path = manifest_dir.join("binaries").join("companion-runtime.exe");

    if runtime_path.exists() {
        return;
    }

    if let Some(parent) = runtime_path.parent() {
        fs::create_dir_all(parent).expect("create runtime resource directory");
    }

    fs::write(&runtime_path, []).expect("create runtime resource placeholder");
}

#[cfg(not(target_os = "windows"))]
fn ensure_runtime_resource_placeholder() {}

fn main() {
    ensure_runtime_resource_placeholder();
    tauri_build::build()
}
