//! Per-adapter live smoke tests (issues #34 Flutter / #35 React Native / #36
//! native-Android + native-iOS), built on the #33 live-device harness. They
//! drive the REAL device bridges per adapter, in TWO opt-in tiers:
//!
//! 1. ALWAYS-ON-WITH-DEVICE tier — gated on `PICKFORGE_E2E_SERIAL` (like #33).
//!    For each Android adapter it asserts the device-layer round-trip that adapter
//!    depends on (screencap → PNG, uiautomator dump → `A11yNode` tree, logcat →
//!    parsed `LogEvent`s) against whatever is already on screen. iOS uses
//!    `PICKFORGE_E2E_IOS_UDID` and asserts simctl screenshot + os_log. No app
//!    build, so it's fast enough to run on every device-equipped check.
//!
//! 2. HEAVY REAL-LAUNCH tier — gated behind the ADDITIONAL `PICKFORGE_E2E_LAUNCH=1`
//!    flag, because a real `flutter run` / `gradle` / `metro` / `xcodebuild`
//!    build is slow and flaky. It launches a real app, screenshots it, then stops
//!    it and asserts clean teardown. It SKIPS (loudly) unless the flag is set AND
//!    a project + toolchain are available, so a plain `cargo test` / CI never
//!    triggers a multi-minute build.
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
#[cfg(target_os = "macos")]
use pickforge_core::android::{A11yNode, A11yRole};
use pickforge_core::detect_target;
#[cfg(target_os = "macos")]
use pickforge_core::ios::{
    built_app_path, bundle_id_of_app, capture_screenshot as ios_capture_screenshot,
    dump_accessibility, dump_recent as ios_dump_recent, find_container as ios_find_container,
    install_app, launch_app, list_devices as ios_list_devices, terminate_app, IosError, SimDevice,
    SimState, XcodeContainerKind,
};

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
        .args([
            "-s",
            serial,
            "logcat",
            "-d",
            "-v",
            "threadtime",
            "-t",
            "200",
        ])
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
    assert_detects_path(&path, want_id, tag);
}

/// Detect a project root and assert it resolves to `want_id`.
fn assert_detects_path(path: &Path, want_id: &str, tag: &str) {
    let d = detect_target(path.to_str().unwrap());
    assert_eq!(
        d.target_id,
        want_id,
        "[{tag}] '{}' detected as '{}', expected '{want_id}'",
        path.display(),
        d.target_id
    );
    eprintln!(
        "[{tag}] detected {} → {} ({})",
        path.display(),
        d.display_name,
        d.target_id
    );
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

/// Max wall-clock any single `adb` invocation in the heavy launch/stop path may
/// take before it's treated as wedged and killed. Kept short: `pidof`,
/// `dumpsys`, and `am force-stop` all return well under a second on a healthy
/// device, so the only thing this bounds is a hung adb that would otherwise stall
/// the `LaunchGuard` / `OnDeviceApp` Drop guards.
const ADB_CALL_TIMEOUT: Duration = Duration::from_secs(15);

/// Spawn `adb args…`, capture stdout, and wait up to `timeout`. If the child
/// overruns the deadline it is KILLED and reaped (so it can't linger), and this
/// returns `None` instead of blocking. `None` is also returned on spawn failure
/// or a non-zero exit — the callers all treat `None` as "couldn't determine /
/// nothing", which is the safe reading for a teardown poll. Bounding this is what
/// keeps a wedged adb from hanging BEFORE the Drop guards run and leaking the
/// spawned build group / on-device app.
///
/// stdout is drained on a dedicated thread the whole time we wait, so a large
/// `dumpsys activity activities` dump (which easily exceeds the OS pipe buffer)
/// can't wedge adb on a blocked write — without that drain, adb would block,
/// `try_wait` would never observe an exit, and this would falsely time out.
fn adb_capture(args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = Command::new("adb")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Drain stdout concurrently so adb is never blocked on a full pipe while we
    // poll for exit (classic pipe-buffer deadlock on big dumps).
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut stdout = stdout;
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let buf = reader.join().unwrap_or_default();
                if !status.success() {
                    return None;
                }
                return Some(String::from_utf8_lossy(&buf).trim().to_string());
            }
            Ok(None) if Instant::now() >= deadline => {
                // Wedged: kill the child and reap it so we neither hang here nor
                // leak the adb process, then report "couldn't determine". Killing
                // the child closes the pipe, which unblocks the reader thread.
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return None;
            }
        }
    }
}

/// `adb -s <serial> shell <args…>` to completion, returning trimmed stdout. The
/// serial is pinned so a connected physical device / other emulators are never
/// touched. Timeout-bounded via `adb_capture`, so a wedged adb can't stall the
/// teardown/poll loop ahead of the Drop guards. `None` on any failure or timeout.
fn adb_shell(serial: &str, args: &[&str]) -> Option<String> {
    let mut full = vec!["-s", serial, "shell"];
    full.extend_from_slice(args);
    adb_capture(&full, ADB_CALL_TIMEOUT)
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

/// A spawned launch process whose whole process TREE is force-killed on `Drop`,
/// so a wedged `flutter run` / `gradle` never leaks the Gradle/adb/Dart
/// descendants it forked. On unix the child is its own process-group leader
/// (spawned with `process_group(0)`), so killing the negative PGID takes down the
/// whole group; on Windows `taskkill /T /F` walks and kills the child's tree.
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
        #[cfg(windows)]
        {
            // `taskkill /T /F /PID <pid>` terminates the child AND its whole tree
            // (Gradle/adb/Dart), the Windows equivalent of the unix group-kill.
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &self.0.id().to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl LaunchGuard {
    /// `Some(success)` once the launch child has exited (build failed / toolchain
    /// misconfigured → it dies almost immediately), else `None` while it's still
    /// running. Lets the foreground poll fail fast on a dead build instead of
    /// waiting the full timeout.
    fn try_exit(&mut self) -> Option<bool> {
        match self.0.try_wait() {
            Ok(Some(status)) => Some(status.success()),
            _ => None,
        }
    }
}

/// Spawn `program args…` in `cwd` so the guard can take down the whole process
/// tree the build tool forks, discarding I/O. On unix the child leads its own
/// process group (`process_group(0)`) so a group-kill reaches every descendant;
/// on Windows the tree is reached via `taskkill /T` in the guard's drop.
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

/// Outcome of waiting for a freshly-launched package to reach the foreground.
enum Launch {
    /// The package owns the resumed activity (the launch landed).
    Foreground,
    /// The launch child (`flutter run`) exited before the package foregrounded —
    /// a build failure / misconfigured toolchain. Fail fast, don't keep polling.
    Died,
    /// Neither happened before the deadline.
    Timeout,
}

/// Poll until `package` is foreground on `serial`, the launch child exits, or
/// `timeout` elapses. Checking `guard` each iteration means a `flutter run` that
/// dies during the build is detected immediately instead of polling `dumpsys`
/// uselessly until the full timeout.
fn wait_for_foreground(
    guard: &mut LaunchGuard,
    serial: &str,
    package: &str,
    timeout: Duration,
) -> Launch {
    let deadline = Instant::now() + timeout;
    loop {
        if package_foreground(serial, package) {
            return Launch::Foreground;
        }
        if guard.try_exit().is_some() {
            return Launch::Died;
        }
        if Instant::now() >= deadline {
            return Launch::Timeout;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

/// Spawn `program args…` with discarded I/O and wait up to `timeout` for it to
/// exit. Returns `Some(success)` if it exited in time, or `None` if it had to be
/// killed for overrunning the deadline (or failed to spawn). Like `adb_capture`,
/// this bounds an otherwise-unbounded `.status()` so a hung toolchain probe can't
/// stall the heavy tier indefinitely. No stdout is piped, so there's no pipe to
/// drain here.
fn spawn_bounded_status(program: &str, args: &[&str], timeout: Duration) -> Option<bool> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.success()),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// `flutter` on PATH and responsive? The heavy Flutter tier needs the SDK. The
/// `flutter --version` probe is time-bounded (a broken / first-run SDK can hang
/// on startup); a hung or absent toolchain reads as unavailable so the tier skips
/// cleanly instead of blocking forever.
fn flutter_available() -> bool {
    spawn_bounded_status("flutter", &["--version"], ADB_CALL_TIMEOUT).unwrap_or(false)
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
    let app = OnDeviceApp {
        serial: serial.clone(),
        package: package.clone(),
    };
    eprintln!(
        "[flutter-heavy] launching `flutter run -d {serial}` in {}",
        project.display()
    );
    let mut guard = spawn_grouped("flutter", &["--color", "run", "-d", &serial], &project)
        .expect("spawn flutter run");

    // A debug build + first install on a cold emulator is slow; give it headroom.
    // But if the run dies early (build failure / bad toolchain) we detect the dead
    // child and fail immediately instead of polling `dumpsys` for the full 300s.
    // Don't let a flaky/slow build read as a pass — fail loudly (the guards still
    // tear down on unwind).
    match wait_for_foreground(&mut guard, &serial, &package, Duration::from_secs(300)) {
        Launch::Foreground => {}
        Launch::Died => panic!(
            "[flutter-heavy] `flutter run` exited before {package} launched \
             (build failure / misconfigured toolchain?) — failing fast"
        ),
        Launch::Timeout => {
            panic!("[flutter-heavy] {package} never reached the foreground within 300s")
        }
    }
    eprintln!("[flutter-heavy] {package} is foreground; capturing the running app");
    assert!(
        package_running(&serial, &package),
        "[flutter-heavy] package not running"
    );

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
    assert!(
        stopped,
        "[flutter-heavy] {package} still running after stop"
    );
    // The device itself must remain online after teardown (didn't crash the emu).
    assert!(
        wait_for_online(&serial, Duration::from_secs(10), Duration::from_secs(1)),
        "[flutter-heavy] {serial} went offline after teardown"
    );
    eprintln!("[flutter-heavy] clean teardown: {package} stopped, {serial} still online");
}

// ── iOS live simulator smokes ───────────────────────────────────────────────

#[test]
fn ios_tier_a_device_roundtrip() {
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("skipped: ios_tier_a_device_roundtrip — iOS live smokes require macOS");
        return;
    }

    #[cfg(target_os = "macos")]
    {
        ios_tier_a_device_roundtrip_macos();
    }
}

#[test]
fn ios_tier_b_real_launch() {
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("skipped: ios_tier_b_real_launch — iOS live smokes require macOS");
        return;
    }

    #[cfg(target_os = "macos")]
    {
        ios_tier_b_real_launch_macos();
    }
}

#[cfg(target_os = "macos")]
const XCODEBUILD_TIMEOUT: Duration = Duration::from_secs(600);

#[cfg(target_os = "macos")]
fn ios_fixture_project() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/sample_ios_app")
}

#[cfg(target_os = "macos")]
fn gated_ios_udid(test: &str) -> Option<String> {
    let udid = match std::env::var("PICKFORGE_E2E_IOS_UDID") {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            eprintln!("skipped: {test} — set PICKFORGE_E2E_IOS_UDID to run");
            return None;
        }
    };

    let devices = match ios_list_devices() {
        Ok(devices) => devices,
        Err(e) => {
            eprintln!("skipped: {test} — xcrun simctl list devices failed ({e})");
            return None;
        }
    };
    let have = ios_device_summary(&devices);
    let Some(device) = devices.iter().find(|d| d.udid == udid) else {
        eprintln!(
            "skipped: {test} — simulator {udid} not found in `simctl list devices` (have: {have})"
        );
        return None;
    };
    if device.state != SimState::Booted {
        eprintln!(
            "skipped: {test} — simulator {udid} is {}, expected Booted (have: {have})",
            ios_state_name(device.state)
        );
        return None;
    }
    Some(udid)
}

#[cfg(target_os = "macos")]
fn ios_device_summary(devices: &[SimDevice]) -> String {
    if devices.is_empty() {
        return "none".to_string();
    }
    devices
        .iter()
        .map(|d| format!("{}={}", d.udid, ios_state_name(d.state)))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(target_os = "macos")]
fn ios_state_name(state: SimState) -> &'static str {
    match state {
        SimState::Booted => "Booted",
        SimState::Shutdown => "Shutdown",
        SimState::Other => "Other",
    }
}

#[cfg(target_os = "macos")]
fn assert_ios_png(bytes: &[u8], tag: &str) {
    assert!(!bytes.is_empty(), "[{tag}] screenshot is empty");
    assert!(
        bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "[{tag}] expected PNG magic bytes, got {:02X?}",
        &bytes[..bytes.len().min(8)]
    );
    eprintln!("[{tag}] screenshot ok: {} bytes", bytes.len());
}

#[cfg(target_os = "macos")]
fn assert_ios_a11y_fixture_tree(udid: &str) {
    let root = match dump_accessibility(udid) {
        Ok(root) => root,
        Err(IosError::MissingDependency(_)) => {
            eprintln!("skipped: ios a11y — idb not found on PATH");
            return;
        }
        Err(e) => panic!("[ios-a11y] dump_accessibility failed: {e}"),
    };

    let node_count = count_a11y_nodes(&root);
    assert!(
        node_count > 0,
        "[ios-a11y] expected non-empty accessibility tree"
    );

    let button = find_a11y_node_by_resource_id(&root, "fixture-button")
        .unwrap_or_else(|| panic!("[ios-a11y] expected fixture-button in accessibility tree"));
    assert_eq!(
        button.role,
        A11yRole::Button,
        "[ios-a11y] expected fixture-button to have Button role"
    );
    assert!(
        find_a11y_node_by_resource_id(&root, "fixture-counter").is_some(),
        "[ios-a11y] expected fixture-counter in accessibility tree"
    );

    eprintln!("[ios-a11y] tree ok: {node_count} nodes, found fixture-button + fixture-counter");
}

#[cfg(target_os = "macos")]
fn count_a11y_nodes(node: &A11yNode) -> usize {
    1 + node.children.iter().map(count_a11y_nodes).sum::<usize>()
}

#[cfg(target_os = "macos")]
fn find_a11y_node_by_resource_id<'a>(
    node: &'a A11yNode,
    resource_id: &str,
) -> Option<&'a A11yNode> {
    if node.resource_id.as_deref() == Some(resource_id) {
        return Some(node);
    }
    node.children
        .iter()
        .find_map(|child| find_a11y_node_by_resource_id(child, resource_id))
}

#[cfg(target_os = "macos")]
fn xcodebuild_available() -> bool {
    spawn_bounded_status("xcodebuild", &["-version"], ADB_CALL_TIMEOUT).unwrap_or(false)
}

#[cfg(target_os = "macos")]
struct CapturedCommand {
    success: bool,
    timed_out: bool,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[cfg(target_os = "macos")]
fn run_bounded_output(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> std::io::Result<CapturedCommand> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn()?;

    let mut stdout = child.stdout.take().expect("stdout pipe");
    let mut stderr = child.stderr.take().expect("stderr pipe");
    let stdout_reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let stderr_reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(CapturedCommand {
                    success: status.success(),
                    timed_out: false,
                    code: status.code(),
                    stdout: stdout_reader.join().unwrap_or_default(),
                    stderr: stderr_reader.join().unwrap_or_default(),
                });
            }
            Ok(None) if Instant::now() >= deadline => {
                kill_child_group(&mut child);
                let status = child.wait().ok();
                return Ok(CapturedCommand {
                    success: false,
                    timed_out: true,
                    code: status.and_then(|s| s.code()),
                    stdout: stdout_reader.join().unwrap_or_default(),
                    stderr: stderr_reader.join().unwrap_or_default(),
                });
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(250)),
            Err(e) => {
                kill_child_group(&mut child);
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(e);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn kill_child_group(child: &mut Child) {
    #[cfg(unix)]
    {
        let neg = format!("-{}", child.id());
        let _ = Command::new("kill")
            .args(["-KILL", "--", &neg])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

#[cfg(target_os = "macos")]
fn output_tail(output: &CapturedCommand, lines: usize) -> String {
    let mut text = String::new();
    if !output.stdout.is_empty() {
        text.push_str("--- stdout ---\n");
        text.push_str(&String::from_utf8_lossy(&output.stdout));
        text.push('\n');
    }
    if !output.stderr.is_empty() {
        text.push_str("--- stderr ---\n");
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if text.trim().is_empty() {
        return "<no xcodebuild output>".to_string();
    }
    let all = text.lines().collect::<Vec<_>>();
    all[all.len().saturating_sub(lines)..].join("\n")
}

#[cfg(target_os = "macos")]
struct IosOnDeviceApp {
    udid: String,
    bundle_id: String,
}

#[cfg(target_os = "macos")]
impl Drop for IosOnDeviceApp {
    fn drop(&mut self) {
        let _ = terminate_app(&self.udid, &self.bundle_id);
    }
}

#[cfg(target_os = "macos")]
fn ios_tier_a_device_roundtrip_macos() {
    let test = "ios_tier_a_device_roundtrip";
    let udid = match gated_ios_udid(test) {
        Some(udid) => udid,
        None => return,
    };
    let project = ios_fixture_project();

    assert_detects_path(&project, "native-ios", "native-ios");
    let bytes = ios_capture_screenshot(&udid)
        .unwrap_or_else(|e| panic!("[native-ios] capture_screenshot failed: {e}"));
    assert_ios_png(&bytes, "native-ios");

    let events = ios_dump_recent(&udid, "2m")
        .unwrap_or_else(|e| panic!("[native-ios] dump_recent failed: {e}"));
    assert!(
        !events.is_empty(),
        "[native-ios] expected parsed events from simulator os_log"
    );
    eprintln!("[native-ios] os_log ok: parsed {} events", events.len());
}

#[cfg(target_os = "macos")]
#[allow(clippy::too_many_lines)] // TODO(#263): split the legacy integration test.
fn ios_tier_b_real_launch_macos() {
    let test = "ios_tier_b_real_launch";
    if !launch_enabled() {
        eprintln!("skipped: {test} — set PICKFORGE_E2E_LAUNCH=1 to run the heavy real-launch tier");
        return;
    }
    let udid = match gated_ios_udid(test) {
        Some(udid) => udid,
        None => return,
    };
    if !xcodebuild_available() {
        eprintln!(
            "skipped: {test} — xcodebuild unavailable (install Xcode or configure xcode-select)"
        );
        return;
    }

    let project = std::env::var("PICKFORGE_E2E_IOS_PROJECT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| ios_fixture_project());
    if !project.is_dir() {
        eprintln!(
            "skipped: {test} — no buildable iOS project at {} (set PICKFORGE_E2E_IOS_PROJECT)",
            project.display()
        );
        return;
    }
    let Some(container) = ios_find_container(&project) else {
        eprintln!(
            "skipped: {test} — no .xcodeproj/.xcworkspace at {} (set PICKFORGE_E2E_IOS_PROJECT)",
            project.display()
        );
        return;
    };

    let scheme =
        std::env::var("PICKFORGE_E2E_IOS_SCHEME").unwrap_or_else(|_| container.name.clone());
    let derived = TempDir::new("ios-derived");
    let destination = format!("id={udid}");
    let mut args = match container.kind {
        XcodeContainerKind::Workspace => vec![
            "-workspace".to_string(),
            container.path.to_string_lossy().into_owned(),
        ],
        XcodeContainerKind::Project => vec![
            "-project".to_string(),
            container.path.to_string_lossy().into_owned(),
        ],
    };
    args.extend([
        "-scheme".to_string(),
        scheme.clone(),
        "-destination".to_string(),
        destination,
        "-derivedDataPath".to_string(),
        derived.path().to_string_lossy().into_owned(),
        "CODE_SIGNING_ALLOWED=NO".to_string(),
        "build".to_string(),
    ]);

    eprintln!(
        "[ios-heavy] building {} scheme `{scheme}` into {}",
        container.path.display(),
        derived.path().display()
    );
    let output = match run_bounded_output("xcodebuild", &args, XCODEBUILD_TIMEOUT) {
        Ok(output) => output,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("skipped: {test} — xcodebuild unavailable (install Xcode or configure xcode-select)");
            return;
        }
        Err(e) => panic!("[ios-heavy] spawn xcodebuild: {e}"),
    };
    if output.timed_out {
        panic!(
            "[ios-heavy] xcodebuild timed out after {:?}\n{}",
            XCODEBUILD_TIMEOUT,
            output_tail(&output, 80)
        );
    }
    if !output.success {
        panic!(
            "[ios-heavy] xcodebuild failed with {:?}\n{}",
            output.code,
            output_tail(&output, 80)
        );
    }

    let app = built_app_path(derived.path(), &scheme);
    assert!(
        app.is_dir(),
        "[ios-heavy] built app missing at {}",
        app.display()
    );
    let bundle_id = match std::env::var("PICKFORGE_E2E_IOS_BUNDLE_ID") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => bundle_id_of_app(&app)
            .unwrap_or_else(|e| panic!("[ios-heavy] read bundle id from app: {e}")),
    };

    install_app(&udid, &app).unwrap_or_else(|e| panic!("[ios-heavy] install_app failed: {e}"));
    let pid = launch_app(&udid, &bundle_id)
        .unwrap_or_else(|e| panic!("[ios-heavy] launch_app failed: {e}"));
    assert!(pid > 0, "[ios-heavy] launch returned invalid pid {pid}");
    let app_guard = IosOnDeviceApp {
        udid: udid.clone(),
        bundle_id: bundle_id.clone(),
    };

    std::thread::sleep(Duration::from_secs(1));
    let bytes = ios_capture_screenshot(&udid)
        .unwrap_or_else(|e| panic!("[ios-heavy] capture_screenshot failed: {e}"));
    assert_ios_png(&bytes, "ios-heavy");
    assert_ios_a11y_fixture_tree(&udid);

    terminate_app(&udid, &bundle_id)
        .unwrap_or_else(|e| panic!("[ios-heavy] terminate_app failed: {e}"));
    drop(app_guard);
    eprintln!("[ios-heavy] launched pid {pid}, captured screenshot, terminated {bundle_id}");
}
