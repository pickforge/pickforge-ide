//! Per-adapter live smoke tests (issues #34 Flutter / #35 React Native / #36
//! native-Android), built on the #33 live-device harness. They drive the REAL
//! device bridges per adapter, in TWO opt-in tiers:
//!
//! 1. ALWAYS-ON-WITH-DEVICE tier — gated on `PICKFORGE_E2E_SERIAL` (like #33).
//!    For each Android adapter it asserts the device-layer round-trip that adapter
//!    depends on (screencap → PNG, uiautomator dump → `A11yNode` tree, logcat →
//!    parsed `LogEvent`s) against whatever is already on screen. No app build, so
//!    it's fast enough to run on every device-equipped check.
//!
//! 2. HEAVY REAL-LAUNCH tier — gated behind the ADDITIONAL `PICKFORGE_E2E_LAUNCH=1`
//!    flag, because a real `flutter run` / `gradle` / `metro` build is slow and
//!    flaky. It actually launches an app on the serial, waits for it to foreground,
//!    screenshots it, dumps its UIAutomator tree, then stops it and asserts clean
//!    teardown. It SKIPS (loudly) unless the flag is set AND a project + toolchain
//!    are available, so a plain `cargo test` / CI never triggers a multi-minute
//!    build.
//!
//! Both tiers SKIP cleanly (printing a `skipped:` line) when their gate is closed,
//! so plain `cargo test` and CI stay green. The shared device primitives (device
//! list, screenshot, uiautomator, logcat parse) are proven in `live_device.rs`;
//! this file proves them PER ADAPTER and adds the real launch/stop lifecycle.
//!
//! ```sh
//! # Tier 1 — fast device round-trip, no app build:
//! PICKFORGE_E2E_SERIAL=emulator-5556 \
//!   cargo test -p pickforge-core --test live_adapters -- --nocapture
//!
//! # Tier 2 — real launch (slow): adds the heavy lifecycle on a real project:
//! PICKFORGE_E2E_SERIAL=emulator-5556 PICKFORGE_E2E_LAUNCH=1 \
//!   cargo test -p pickforge-core --test live_adapters -- --nocapture
//! ```

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use pickforge_core::android::{
    capture_screenshot, dump_uiautomator_xml, list_devices, logcat_event, parse_uiautomator,
    wait_for_online, LogLevel,
};
use pickforge_core::detect_target;

// ── Shared gating ───────────────────────────────────────────────────────────

/// The serial under test, or `None` when the always-on gate is closed (var unset
/// / adb missing / serial not online). A `None` result means the caller skips.
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

/// True when the additional heavy-launch flag is set. The heavy tier needs BOTH
/// this and an online serial; this gate is checked first so an un-flagged run
/// skips before doing any device work.
fn launch_enabled() -> bool {
    matches!(std::env::var("PICKFORGE_E2E_LAUNCH"), Ok(v) if v == "1" || v.eq_ignore_ascii_case("true"))
}

/// A throwaway directory under the OS temp dir, removed on `Drop`.
struct TempDir(PathBuf);

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
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ── Shared device-layer assertions (Tier 1 building blocks) ─────────────────

/// Assert `capture_screenshot` writes a real (PNG-magic) non-empty file for the
/// adapter under `tag`.
fn assert_screencap_png(serial: &str, tag: &str) {
    let dir = TempDir::new(tag);
    let out = capture_screenshot(serial, dir.path().to_str().unwrap(), "live.png")
        .unwrap_or_else(|| panic!("[{tag}] capture_screenshot returned a path"));
    let bytes = std::fs::read(&out).expect("read captured screenshot");
    assert!(!bytes.is_empty(), "[{tag}] screenshot is empty");
    assert!(
        bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "[{tag}] expected PNG magic bytes, got {:02X?}",
        &bytes[..bytes.len().min(8)]
    );
    eprintln!("[{tag}] screenshot ok: {out} ({} bytes)", bytes.len());
}

/// Assert `dump_uiautomator_xml` → `parse_uiautomator` yields a non-empty tree.
/// `uiautomator dump` is occasionally flaky — it refuses to dump while the window
/// is mid-animation (common right after an app launch, returning nothing) — so
/// retry a few times with a short settle before failing.
fn assert_uiautomator_tree(serial: &str, tag: &str) {
    let mut last = String::new();
    for attempt in 1..=5 {
        match dump_uiautomator_xml(serial) {
            Some(xml) if xml.contains('<') => match parse_uiautomator(&xml) {
                Ok(root) if !root.children.is_empty() => {
                    eprintln!(
                        "[{tag}] uiautomator ok: root '{}' with {} top-level children (attempt {attempt})",
                        root.class_name,
                        root.children.len()
                    );
                    return;
                }
                Ok(_) => last = "parsed a bare root (no children)".to_string(),
                Err(e) => last = format!("parse failed: {e:?}"),
            },
            Some(_) => last = "dump did not look like XML".to_string(),
            None => last = "dump_uiautomator_xml returned None".to_string(),
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    panic!("[{tag}] no UIAutomator tree after 5 attempts ({last})");
}

/// Assert a bounded `adb logcat` dump parses into `LogEvent`s (the Logs view's
/// input). `-d` dumps then exits, so there is no long-lived stream to leak; `-t`
/// caps the slice. The dump is killed if it overruns the deadline.
fn assert_logcat_events(serial: &str, tag: &str) {
    let mut child = Command::new("adb")
        .args(["-s", serial, "logcat", "-d", "-v", "threadtime", "-t", "200"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|e| panic!("[{tag}] spawn adb logcat: {e}"));

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
        "[{tag}] expected parsed events from `-v threadtime` lines"
    );
    assert!(events.iter().all(|e| e.source == "logcat"));
    assert!(events.iter().all(|e| matches!(
        e.level,
        LogLevel::Info | LogLevel::Warning | LogLevel::Error
    )));
    eprintln!("[{tag}] logcat ok: parsed {} events", events.len());
}

/// The fixture root the harness detects each adapter from (mirrors the TS layer's
/// `tests/e2e/fixtures/<dir>`). Detection runs on these real files.
fn fixture(dir: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/e2e/fixtures")
        .join(dir)
}

/// Detect a fixture's target and assert it resolves to `want_id`.
fn assert_detects(dir: &str, want_id: &str, tag: &str) {
    let path = fixture(dir);
    let d = detect_target(path.to_str().unwrap());
    assert_eq!(
        d.target_id, want_id,
        "[{tag}] '{}' detected as '{}', expected '{want_id}'",
        path.display(), d.target_id
    );
    eprintln!("[{tag}] detected {dir} → {} ({})", d.display_name, d.target_id);
}

// ── Tier 1: always-on-with-device per-adapter device round-trips ─────────────

#[test]
fn flutter_device_roundtrip() {
    let tag = "flutter";
    let serial = match gated_serial("flutter_device_roundtrip") {
        Some(s) => s,
        None => return,
    };
    // #34: detection on the fixture resolves Flutter (inspectorKind vmService is
    // asserted in the TS run-command contract), then the device-layer round-trip
    // the screenshot/inspect flow relies on holds against the live device.
    assert_detects("flutter-app", "flutter", tag);
    assert_screencap_png(&serial, tag);
    assert_uiautomator_tree(&serial, tag);
}

#[test]
fn react_native_device_roundtrip() {
    let tag = "react-native";
    let serial = match gated_serial("react_native_device_roundtrip") {
        Some(s) => s,
        None => return,
    };
    // #35: detection resolves react-native; screenshot + UIAutomator + logcat all
    // round-trip (RN inspects via UIAutomator and streams logs via logcat).
    assert_detects("rn-app", "react-native", tag);
    assert_screencap_png(&serial, tag);
    assert_uiautomator_tree(&serial, tag);
    assert_logcat_events(&serial, tag);
}

#[test]
fn native_android_device_roundtrip() {
    let tag = "native-android";
    let serial = match gated_serial("native_android_device_roundtrip") {
        Some(s) => s,
        None => return,
    };
    // #36: detection resolves native-android; same UIAutomator + logcat lane as RN.
    assert_detects("native-android-app", "native-android", tag);
    assert_screencap_png(&serial, tag);
    assert_uiautomator_tree(&serial, tag);
    assert_logcat_events(&serial, tag);
}

// ── Tier 2: heavy real-launch lifecycle (gated on PICKFORGE_E2E_LAUNCH=1) ─────

/// `adb -s <serial> shell <args…>` to completion, returning trimmed stdout. The
/// serial is pinned so a connected physical device / other emulators are never
/// touched. `None` on any failure.
fn adb_shell(serial: &str, args: &[&str]) -> Option<String> {
    let mut full = vec!["-s", serial, "shell"];
    full.extend_from_slice(args);
    let out = Command::new("adb")
        .args(&full)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Whether `package` has a live process on the device (the issue's `pidof` check).
fn package_running(serial: &str, package: &str) -> bool {
    adb_shell(serial, &["pidof", package]).is_some_and(|s| !s.is_empty())
}

/// Whether `package` owns the resumed/foreground activity, via `dumpsys activity
/// activities` (the line the workbench would use to confirm a launch landed).
fn package_foreground(serial: &str, package: &str) -> bool {
    adb_shell(serial, &["dumpsys", "activity", "activities"]).is_some_and(|dump| {
        dump.lines()
            .filter(|l| l.contains("mResumedActivity") || l.contains("ResumedActivity"))
            .any(|l| l.contains(package))
    })
}

/// Force-stop `package` on the device (heavy-tier teardown).
fn force_stop(serial: &str, package: &str) {
    let _ = adb_shell(serial, &["am", "force-stop", package]);
}

/// Panic-safe on-device teardown: `am force-stop`s the launched package on
/// `Drop`, so even an assertion panic between launch and the explicit stop never
/// leaves the app running on the emulator.
struct OnDeviceApp {
    serial: String,
    package: String,
}

impl Drop for OnDeviceApp {
    fn drop(&mut self) {
        force_stop(&self.serial, &self.package);
    }
}

/// A spawned launch process whose whole group is SIGKILLed on `Drop`, so a
/// wedged `flutter run` / `gradle` never leaks past the test. The child is its
/// own process-group leader (spawned with `process_group(0)`), so killing the
/// negative PGID takes down every descendant the build tool forked.
struct LaunchGuard(Child);

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            // `kill -KILL -<pgid>` (PGID == child PID here) — no libc needed, and
            // `kill` is universally present on unix. SIGKILL is unconditional.
            let neg = format!("-{}", self.0.id());
            let _ = Command::new("kill")
                .args(["-KILL", "--", &neg])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Spawn `program args…` in `cwd` as its own process group (so the guard's
/// group-kill takes down every descendant the build tool forks), discarding I/O.
fn spawn_grouped(program: &str, args: &[&str], cwd: &Path) -> std::io::Result<LaunchGuard> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    Ok(LaunchGuard(cmd.spawn()?))
}

/// Poll until `package` is foreground on `serial`, or `timeout` elapses.
fn wait_for_foreground(serial: &str, package: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if package_foreground(serial, package) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

/// `flutter` on PATH? The heavy Flutter tier needs the SDK.
fn flutter_available() -> bool {
    Command::new("flutter")
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[test]
fn flutter_heavy_launch_lifecycle() {
    let test = "flutter_heavy_launch_lifecycle";
    if !launch_enabled() {
        eprintln!("skipped: {test} — set PICKFORGE_E2E_LAUNCH=1 to run the heavy real-launch tier");
        return;
    }
    let serial = match gated_serial(test) {
        Some(s) => s,
        None => return, // gated_serial already logged the skip reason
    };
    if !flutter_available() {
        eprintln!("skipped: {test} — flutter SDK not on PATH (heavy tier needs a real build)");
        return;
    }
    // A real, buildable Flutter app the operator can override; defaults to the
    // repo's sample app (has a full android/ project + a known applicationId).
    let project = std::env::var("PICKFORGE_E2E_FLUTTER_PROJECT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/sample_flutter_app")
        });
    if !project.join("android").is_dir() {
        eprintln!(
            "skipped: {test} — no buildable Flutter project at {} (set PICKFORGE_E2E_FLUTTER_PROJECT)",
            project.display()
        );
        return;
    }
    let package = std::env::var("PICKFORGE_E2E_FLUTTER_PACKAGE")
        .unwrap_or_else(|_| "com.pickforge.pickforge_sample_flutter_app".to_string());

    // Clean slate, then launch the real run pinned to the serial (the workbench's
    // `flutter --color run -d <serial>`). `guard` SIGKILLs the whole build group
    // on drop; `app` force-stops the on-device package on drop — so a panic
    // anywhere below still tears BOTH down (no leaked build, no app left running).
    force_stop(&serial, &package);
    let app = OnDeviceApp { serial: serial.clone(), package: package.clone() };
    eprintln!("[flutter-heavy] launching `flutter run -d {serial}` in {}", project.display());
    let guard = spawn_grouped(
        "flutter",
        &["--color", "run", "-d", &serial],
        &project,
    )
    .expect("spawn flutter run");

    // A debug build + first install on a cold emulator is slow; give it headroom.
    let launched = wait_for_foreground(&serial, &package, Duration::from_secs(300));
    // Don't let a flaky/slow build read as a pass — fail loudly (the guards still
    // tear down on unwind).
    assert!(
        launched,
        "[flutter-heavy] {package} never reached the foreground within 300s"
    );
    eprintln!("[flutter-heavy] {package} is foreground; capturing the running app");
    assert!(package_running(&serial, &package), "[flutter-heavy] package not running");

    // Let the launch animation settle so `uiautomator dump` (which refuses to run
    // mid-animation) has a stable window to read.
    std::thread::sleep(Duration::from_secs(3));

    // Screenshot + UIAutomator dump of the RUNNING app (not whatever was on
    // screen before) — the inspect/screenshot round-trip against a live launch.
    assert_screencap_png(&serial, "flutter-heavy");
    assert_uiautomator_tree(&serial, "flutter-heavy");

    // Stop and assert clean teardown: the build group is killed (guard drop) and
    // the on-device app is force-stopped, then confirm the process is gone.
    drop(guard);
    drop(app);
    let stopped = {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if !package_running(&serial, &package) {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    };
    assert!(stopped, "[flutter-heavy] {package} still running after stop");
    // The device itself must remain online after teardown (didn't crash the emu).
    assert!(
        wait_for_online(&serial, Duration::from_secs(10), Duration::from_secs(1)),
        "[flutter-heavy] {serial} went offline after teardown"
    );
    eprintln!("[flutter-heavy] clean teardown: {package} stopped, {serial} still online");
}
