// Prevent a console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// GTK3's Wayland frame clock throttles WebKitGTK rendering updates hard
/// (measured 30fps on a 120Hz output under KWin with mixed-refresh monitors),
/// while the same webview under XWayland runs at the full panel rate. Prefer
/// the X11 backend — with wayland as GTK's own fallback should the advertised
/// DISPLAY turn out stale. The preference is applied in-process via GDK (never
/// through the environment), so child shells, agents, and GTK apps launched
/// from the app are untouched.
///
/// The decision of *whether* to prefer X11 (and whether to also disable
/// WebKitGTK's DMA-BUF renderer) comes from the persisted Linux graphics mode
/// (#238) — see [`pickforge_core::resolve_graphics_backend_plan`] — which in
/// turn already accounts for `PICKFORGE_WAYLAND` and explicit `GDK_BACKEND` /
/// `WEBKIT_DISABLE_DMABUF_RENDERER` overrides. This function only adds the
/// mixed-session runtime guard: forcing X11 when no XWayland is actually
/// running (no `WAYLAND_DISPLAY` + `DISPLAY` pair) would leave GDK without a
/// working backend at all.
#[cfg(target_os = "linux")]
fn apply_linux_graphics_mode() {
    let env: std::collections::HashMap<String, String> = std::env::vars().collect();
    let mode = pickforge_core::load_linux_graphics_config().mode;
    let plan = pickforge_core::resolve_graphics_backend_plan(mode, &env);

    let wayland = env.contains_key("WAYLAND_DISPLAY");
    let x11 = env.contains_key("DISPLAY");
    if plan.prefer_x11 && wayland && x11 {
        gtk::gdk::set_allowed_backends("x11,wayland");
    }

    if let Some(value) = plan.set_dmabuf_disabled {
        // WebKitGTK reads this directly from the process environment before
        // any in-process API can substitute for it, so — unlike the GDK
        // backend preference above — it must be a real env var. Compatibility
        // mode must affect PickForge only: mark it as PickForge-synthesized so
        // `user_shell_environment()` never forwards it to spawned shells or
        // agents (#238).
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", value);
        pickforge_core::mark_linux_dmabuf_env_synthesized();
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
    apply_linux_graphics_mode();
    pickforge_tauri_lib::run()
}
