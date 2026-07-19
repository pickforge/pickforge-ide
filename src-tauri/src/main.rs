// Prevent a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// GTK3's Wayland frame clock throttles WebKitGTK rendering updates hard
/// (measured 30fps on a 120Hz output under KWin with mixed-refresh monitors),
/// while the same webview under XWayland runs at the full panel rate. Prefer
/// the X11 backend — with wayland as GTK's own fallback should the advertised
/// DISPLAY turn out stale. The preference is applied in-process via GDK (never
/// through the environment), so child shells, agents, and GTK apps launched
/// from the app are untouched. Setting PICKFORGE_WAYLAND to anything except
/// 0/false/empty opts back into native Wayland; an explicit GDK_BACKEND always
/// wins because GDK itself gives the env var precedence.
#[cfg(target_os = "linux")]
fn prefer_x11_backend() {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let x11 = std::env::var_os("DISPLAY").is_some();
    let explicit_backend = std::env::var_os("GDK_BACKEND").is_some();
    let wants_wayland = std::env::var("PICKFORGE_WAYLAND")
        .map(|v| !matches!(v.trim(), "" | "0" | "false"))
        .unwrap_or(false);
    if wayland && x11 && !explicit_backend && !wants_wayland {
        gtk::gdk::set_allowed_backends("x11,wayland");
    }
}

fn main() {
    // Crash-containment guardian re-exec (#208): this must run before any
    // Tauri/GTK/single-instance init — the guardian is this same binary and
    // must never become a second app instance.
    if pickforge_core::guardian_requested() {
        pickforge_core::guardian_main();
    }
    #[cfg(target_os = "linux")]
    prefer_x11_backend();
    pickforge_tauri_lib::run()
}
