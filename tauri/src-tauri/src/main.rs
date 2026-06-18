// Prevent a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pickforge_tauri_lib::run()
}
