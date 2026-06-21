//! Opt-in live-device integration tests. These drive the REAL Android device
//! bridges (adb screenshot, UIAutomator dump, logcat) against a running
//! emulator/handset — the layer the mocked Playwright VRT can never exercise.
//!
//! Gated on `PICKFORGE_E2E_SERIAL` (e.g. `emulator-5556`). When it is unset, adb
//! is missing, or the serial is not an online device, every test SKIPS cleanly
//! (prints a `skipped:` line and returns) so plain `cargo test` and CI stay
//! green. Set the var to run them:
//!
//! ```sh
//! PICKFORGE_E2E_SERIAL=emulator-5556 \
//!   cargo test -p pickforge-core --test live_device -- --nocapture
//! ```

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use pickforge_core::android::{
    capture_screenshot, dump_uiautomator_xml, list_devices, logcat_event, parse_uiautomator,
    LogLevel,
};

/// The serial under test, or `None` when the gate is closed (var unset / adb
/// missing / serial not online). A `None` result means the caller skips.
fn gated_serial(test: &str) -> Option<String> {
    let serial = match std::env::var("PICKFORGE_E2E_SERIAL") {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            eprintln!("skipped: {test} — set PICKFORGE_E2E_SERIAL (e.g. emulator-5556) to run");
            return None;
        }
    };
    let devices = list_devices();
    if devices.is_empty() {
        eprintln!("skipped: {test} — adb reported no devices (adb missing or no emulator)");
        return None;
    }
    if !devices.iter().any(|d| d.serial == serial && d.is_online()) {
        eprintln!(
            "skipped: {test} — {serial} is not an online device (have: {})",
            devices
                .iter()
                .map(|d| format!("{}={}", d.serial, d.state))
                .collect::<Vec<_>>()
                .join(", ")
        );
        return None;
    }
    Some(serial)
}

/// A throwaway directory under the OS temp dir, removed on `Drop`.
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "pf-live-{tag}-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        TempDir(dir)
    }
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn live_serial_is_online_in_device_list() {
    let serial = match gated_serial("live_serial_is_online_in_device_list") {
        Some(s) => s,
        None => return,
    };
    let devices = list_devices();
    let dev = devices
        .iter()
        .find(|d| d.serial == serial)
        .expect("gated serial present in list_devices()");
    assert!(dev.is_online(), "expected {serial} online, got state {}", dev.state);
}

#[test]
fn live_screenshot_writes_a_real_png() {
    let serial = match gated_serial("live_screenshot_writes_a_real_png") {
        Some(s) => s,
        None => return,
    };
    let dir = TempDir::new("shot");
    let out = capture_screenshot(&serial, dir.path().to_str().unwrap(), "live.png")
        .expect("capture_screenshot returned a path");

    let bytes = std::fs::read(&out).expect("read captured screenshot");
    assert!(!bytes.is_empty(), "screenshot is empty");
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A.
    assert!(
        bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "expected PNG magic bytes, got {:02X?}",
        &bytes[..bytes.len().min(8)]
    );
    eprintln!("live screenshot: {out} ({} bytes)", bytes.len());
}

#[test]
fn live_uiautomator_dump_parses_to_a_tree() {
    let serial = match gated_serial("live_uiautomator_dump_parses_to_a_tree") {
        Some(s) => s,
        None => return,
    };
    let xml = dump_uiautomator_xml(&serial).expect("dump_uiautomator_xml returned XML");
    assert!(xml.contains('<'), "dump did not look like XML");

    let root = parse_uiautomator(&xml).expect("parse_uiautomator built a tree");
    assert!(
        !root.children.is_empty(),
        "expected a non-empty UIAutomator tree (root + children), got a bare root"
    );
    eprintln!(
        "live uiautomator: root '{}' with {} top-level children",
        root.class_name,
        root.children.len()
    );
}

#[test]
fn live_logcat_lines_parse_into_events() {
    let serial = match gated_serial("live_logcat_lines_parse_into_events") {
        Some(s) => s,
        None => return,
    };

    // Sample a bounded slice of the device's ring buffer (`-d` dumps then exits,
    // so there is no long-lived stream to leak), in the threadtime format the
    // core parser reads. `-t 200` caps the dump so a chatty device can't flood.
    let mut child = Command::new("adb")
        .args(["-s", &serial, "logcat", "-d", "-v", "threadtime", "-t", "200"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn adb logcat");

    // Belt-and-braces against a wedged adb: bound the dump and kill it if it
    // overruns, so the test never leaks the child or hangs.
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }

    let output = child.wait_with_output().expect("collect adb logcat output");
    let text = String::from_utf8_lossy(&output.stdout);

    let events: Vec<_> = text.lines().filter_map(logcat_event).collect();
    assert!(
        !events.is_empty(),
        "expected the parser to yield events from real `-v threadtime` lines"
    );
    // Every parsed event carries the logcat source and a known level — this is the
    // struct the Logs view consumes.
    assert!(events.iter().all(|e| e.source == "logcat"));
    assert!(events.iter().all(|e| matches!(
        e.level,
        LogLevel::Info | LogLevel::Warning | LogLevel::Error
    )));
    eprintln!("live logcat: parsed {} events from the ring buffer", events.len());
}
