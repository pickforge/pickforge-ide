#[cfg(target_os = "macos")]
const DEFAULT_BAR_HEIGHT: f64 = 38.0;

#[cfg(any(target_os = "macos", test))]
fn centered_container_height(bar_height: f64, button_height: f64, natural_y: f64) -> f64 {
    let top_padding = ((bar_height - button_height) / 2.0).max(0.0);
    button_height + natural_y + top_padding
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicPtr, AtomicU64, AtomicU8, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    use block2::RcBlock;
    use dispatch2::{DispatchQueue, DispatchTime};
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSWindow, NSWindowButton, NSWindowDidChangeBackingPropertiesNotification,
        NSWindowDidEndLiveResizeNotification, NSWindowDidEnterFullScreenNotification,
        NSWindowDidExitFullScreenNotification, NSWindowDidResizeNotification,
        NSWindowDidUpdateNotification, NSWindowStyleMask, NSWindowWillEnterFullScreenNotification,
        NSWindowWillExitFullScreenNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSNotificationName};
    use tauri::WebviewWindow;

    use super::{centered_container_height, DEFAULT_BAR_HEIGHT};

    const CLOSE_BUTTON_X: f64 = 14.0;
    const MIN_BAR_HEIGHT: f64 = 16.0;
    const MAX_BAR_HEIGHT: f64 = 160.0;
    const FRAME_EPSILON: f64 = 0.25;
    const PHASE_IDLE: u8 = 0;
    const PHASE_ENTERING: u8 = 1;

    static TARGET_BAR_HEIGHT: Mutex<f64> = Mutex::new(DEFAULT_BAR_HEIGHT);
    static NATURAL_BUTTON_Y: OnceLock<f64> = OnceLock::new();
    static BUTTON_SPACING: OnceLock<f64> = OnceLock::new();
    static OBSERVED_WINDOW: AtomicPtr<NSWindow> = AtomicPtr::new(std::ptr::null_mut());
    static FULLSCREEN_PHASE: AtomicU8 = AtomicU8::new(PHASE_IDLE);
    static PHASE_GENERATION: AtomicU64 = AtomicU64::new(0);

    pub(super) fn set_bar_height(window: WebviewWindow, bar_height: f64) -> Result<(), String> {
        if !bar_height.is_finite() || !(MIN_BAR_HEIGHT..=MAX_BAR_HEIGHT).contains(&bar_height) {
            return Err(format!(
                "traffic-light bar height must be finite and between {MIN_BAR_HEIGHT} and {MAX_BAR_HEIGHT} points; got {bar_height}"
            ));
        }
        *TARGET_BAR_HEIGHT
            .lock()
            .expect("traffic-light target lock poisoned") = bar_height;

        let main_window = window.clone();
        window
            .run_on_main_thread(move || unsafe { install_and_apply(&main_window) })
            .map_err(|error| error.to_string())
    }

    pub fn position_at_default(window: &WebviewWindow) {
        let main_window = window.clone();
        let _ = window.run_on_main_thread(move || unsafe { install_and_apply(&main_window) });
    }

    unsafe fn install_and_apply(window: &WebviewWindow) {
        let Ok(pointer) = window.ns_window() else {
            return;
        };
        let ns_window = &*(pointer.cast::<NSWindow>());
        let window_pointer = (ns_window as *const NSWindow).cast_mut();
        if OBSERVED_WINDOW.swap(window_pointer, Ordering::SeqCst) != window_pointer {
            install_observers(ns_window);
        }
        apply_target(ns_window);
    }

    unsafe fn install_observers(ns_window: &NSWindow) {
        for name in [
            NSWindowDidResizeNotification,
            NSWindowDidEndLiveResizeNotification,
            NSWindowDidUpdateNotification,
            NSWindowDidChangeBackingPropertiesNotification,
        ] {
            observe_window(name, ns_window, |window| unsafe { apply_target(window) });
        }

        observe_window(NSWindowWillEnterFullScreenNotification, ns_window, |_| {
            begin_fullscreen_phase(PHASE_ENTERING);
        });
        observe_window(NSWindowDidEnterFullScreenNotification, ns_window, |_| {
            end_fullscreen_phase();
        });
        observe_window(NSWindowWillExitFullScreenNotification, ns_window, |_| {
            end_fullscreen_phase();
        });
        observe_window(NSWindowDidExitFullScreenNotification, ns_window, |window| {
            end_fullscreen_phase();
            unsafe { apply_target(window) };
        });
    }

    fn begin_fullscreen_phase(phase: u8) {
        FULLSCREEN_PHASE.store(phase, Ordering::SeqCst);
        let generation = PHASE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let deadline = DispatchTime::try_from(Duration::from_secs(2))
            .expect("two-second dispatch deadline must be representable");
        let _ = DispatchQueue::main().after(deadline, move || {
            if PHASE_GENERATION.load(Ordering::SeqCst) == generation {
                FULLSCREEN_PHASE.store(PHASE_IDLE, Ordering::SeqCst);
            }
        });
    }

    fn end_fullscreen_phase() {
        PHASE_GENERATION.fetch_add(1, Ordering::SeqCst);
        FULLSCREEN_PHASE.store(PHASE_IDLE, Ordering::SeqCst);
    }

    unsafe fn observe_window(
        name: &'static NSNotificationName,
        ns_window: &NSWindow,
        handler: impl Fn(&NSWindow) + 'static,
    ) {
        let retained = Retained::retain((ns_window as *const NSWindow).cast_mut())
            .expect("main NSWindow pointer must be non-null");
        let object = &*((ns_window as *const NSWindow).cast::<AnyObject>());
        let block = RcBlock::new(move |_: NonNull<NSNotification>| handler(&retained));
        let token = NSNotificationCenter::defaultCenter()
            .addObserverForName_object_queue_usingBlock(Some(name), Some(object), None, &block);
        std::mem::forget(block);
        std::mem::forget(token);
    }

    unsafe fn apply_target(ns_window: &NSWindow) {
        let phase = FULLSCREEN_PHASE.load(Ordering::SeqCst);
        if phase == PHASE_ENTERING
            || ns_window
                .styleMask()
                .contains(NSWindowStyleMask::FullScreen)
        {
            return;
        }

        let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
            return;
        };
        let Some(minimize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
        else {
            return;
        };
        let Some(zoom) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) else {
            return;
        };
        let Some(container) = close.superview().and_then(|view| view.superview()) else {
            return;
        };

        let close_frame = close.frame();
        let measured_spacing = minimize.frame().origin.x - close_frame.origin.x;
        if close_frame.size.height <= 1.0 || measured_spacing <= 1.0 {
            return;
        }
        let natural_y = *NATURAL_BUTTON_Y.get_or_init(|| close_frame.origin.y);
        let spacing = *BUTTON_SPACING.get_or_init(|| measured_spacing);
        let bar_height = *TARGET_BAR_HEIGHT
            .lock()
            .expect("traffic-light target lock poisoned");
        let container_height =
            centered_container_height(bar_height, close_frame.size.height, natural_y);

        let mut container_frame = container.frame();
        let target_container_y = ns_window.frame().size.height - container_height;
        if differs(container_frame.size.height, container_height)
            || differs(container_frame.origin.y, target_container_y)
        {
            container_frame.size.height = container_height;
            container_frame.origin.y = target_container_y;
            container.setFrame(container_frame);
        }

        for (index, button) in [&close, &minimize, &zoom].into_iter().enumerate() {
            let mut frame = button.frame();
            let target_x = CLOSE_BUTTON_X + index as f64 * spacing;
            if differs(frame.origin.x, target_x) || differs(frame.origin.y, natural_y) {
                frame.origin.x = target_x;
                frame.origin.y = natural_y;
                button.setFrameOrigin(frame.origin);
            }
        }
    }

    fn differs(actual: f64, target: f64) -> bool {
        (actual - target).abs() > FRAME_EPSILON
    }
}

#[cfg(target_os = "macos")]
pub use macos::position_at_default;

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_traffic_light_bar_height(
    window: tauri::WebviewWindow,
    bar_height: f64,
) -> Result<(), String> {
    macos::set_bar_height(window, bar_height)
}

#[cfg(test)]
mod tests {
    use super::centered_container_height;

    #[test]
    fn container_height_centers_buttons_at_every_supported_zoom_sample() {
        for (bar_height, natural_y) in [(38.0, 5.0), (47.5, 5.0), (57.0, 7.0)] {
            let button_height = 14.0;
            let container_height = centered_container_height(bar_height, button_height, natural_y);
            let center_from_window_top = container_height - natural_y - button_height / 2.0;
            assert!((center_from_window_top - bar_height / 2.0).abs() < f64::EPSILON);
        }
    }
}
