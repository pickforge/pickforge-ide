// Prevent a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// GTK3's Wayland frame clock throttles WebKitGTK rendering updates hard
/// (measured 30fps on a 120Hz output under KWin with mixed-refresh monitors),
/// while the same webview under XWayland runs at the full panel rate. Prefer
/// the X11 backend when both servers are reachable; PICKFORGE_WAYLAND=1 (or an
/// explicit GDK_BACKEND) opts back into native Wayland.
#[cfg(target_os = "linux")]
fn prefer_x11_backend() {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let x11 = std::env::var_os("DISPLAY").is_some();
    let overridden = std::env::var_os("GDK_BACKEND").is_some()
        || std::env::var_os("PICKFORGE_WAYLAND").is_some();
    if wayland && x11 && !overridden {
        std::env::set_var("GDK_BACKEND", "x11");
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    prefer_x11_backend();
    pickforge_tauri_lib::run()
}
