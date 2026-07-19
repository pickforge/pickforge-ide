//! Forced-exit regression harness for local crash containment (#208 PR 2).
//!
//! This binary (`harness = false`) plays three roles:
//!
//! * default — the test driver;
//! * guardian — activated only by the `--pickforge-containment-guardian` argv
//!   sentinel PLUS the one-time token in `PICKFORGE_CONTAINMENT_GUARDIAN`,
//!   exactly as the shipped app binary dispatches it in `main`;
//! * `PF_CC_ROLE=app` — a stand-in PickForge instance: it starts crash
//!   containment, spawns an owned child that forks a grandchild, registers the
//!   owned tree root, then dies in the scenario-selected way WITHOUT running
//!   any graceful teardown;
//! * `PF_CC_ROLE=ambient-env-probe` — reports whether an INHERITED
//!   `PICKFORGE_CONTAINMENT_GUARDIAN` env var (no argv sentinel) would hijack
//!   the launch into guardian mode. It must not (#246 review, P1).
//!
//! Each scenario asserts that the whole owned tree — child AND grandchild —
//! disappears after the "app" dies via normal close (exit 0), SIGTERM, panic,
//! abort, or forced SIGKILL. Unix-only; the Windows Job Object path is
//! kernel-enforced (kill on last handle close) and is validated on Windows CI.

#[cfg(unix)]
mod unix {
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    const SCENARIOS: [&str; 5] = ["exit", "sigterm", "panic", "abort", "sigkill"];

    pub fn main() {
        if pickforge_core::guardian_requested() {
            pickforge_core::guardian_main();
        }
        match std::env::var("PF_CC_ROLE").ok().as_deref() {
            Some("app") => {
                app_role();
                return;
            }
            Some("ambient-env-probe") => {
                // Exit 0 only when the inherited env var did NOT activate
                // guardian mode (we were spawned without the argv sentinel).
                std::process::exit(u8::from(pickforge_core::guardian_requested()).into());
            }
            _ => {}
        }
        let mut failures = Vec::new();
        print!("crash_containment::ambient_env_var_does_not_become_guardian ... ");
        match ambient_env_scenario() {
            Ok(()) => println!("ok"),
            Err(error) => {
                println!("FAILED: {error}");
                failures.push("ambient-env");
            }
        }
        for scenario in SCENARIOS {
            print!("crash_containment::{scenario} ... ");
            match run_scenario(scenario) {
                Ok(()) => println!("ok"),
                Err(error) => {
                    println!("FAILED: {error}");
                    failures.push(scenario);
                }
            }
        }
        if !failures.is_empty() {
            eprintln!("failed scenarios: {failures:?}");
            std::process::exit(1);
        }
    }

    /// The stand-in PickForge instance. Protocol with the driver over files in
    /// `PF_CC_DIR`: writes `grand.pid` (grandchild) and `ready` when the owned
    /// tree is registered, then dies per `PF_CC_EXIT`.
    fn app_role() {
        let dir = PathBuf::from(std::env::var("PF_CC_DIR").expect("PF_CC_DIR set"));
        let mode = std::env::var("PF_CC_EXIT").expect("PF_CC_EXIT set");

        // Start containment exactly like the shipped `run()` does (the shipped
        // path additionally gates on PICKFORGE_LOCAL_CRASH_CONTAINMENT).
        let ctx = pickforge_core::ContainmentContext {
            sessions_dir: Some(dir.join("sessions")),
            tmux_server: None,
            tmux_program: None,
        };
        pickforge_core::start_local_crash_containment(&ctx).expect("start containment");

        // Owned tree root: a shell that forks a background grandchild and then
        // execs into a long sleep. Both would outlive this process without
        // containment. Group leader per the PR 1 ownership contract.
        let grand_pid = dir.join("grand.pid");
        let script = format!(
            "sleep 300 & echo $! > '{}'; exec sleep 300",
            grand_pid.display()
        );
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(script).stdin(Stdio::null());
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let child = command.spawn().expect("spawn owned tree root");
        pickforge_core::contain_owned_root(child.id());

        // Wait until the grandchild exists so the driver can track it.
        let deadline = Instant::now() + Duration::from_secs(10);
        while !grand_pid.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        std::fs::write(dir.join("root.pid"), child.id().to_string()).expect("write root pid");
        std::fs::write(dir.join("ready"), b"1").expect("write ready");

        // Self-terminating modes race the driver's tree-alive check: wait for
        // its `go` ack so the crash is only induced after the tree was seen.
        if matches!(mode.as_str(), "exit" | "panic" | "abort") {
            let deadline = Instant::now() + Duration::from_secs(15);
            while !dir.join("go").exists() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        match mode.as_str() {
            // Normal close WITHOUT graceful teardown: strict ownership says the
            // tree must still die with the app.
            "exit" => std::process::exit(0),
            "panic" => panic!("simulated PickForge panic"),
            "abort" => std::process::abort(),
            // sigterm/sigkill: wait to be killed by the driver.
            _ => loop {
                std::thread::sleep(Duration::from_secs(1));
            },
        }
    }

    /// Regression (#246 review): a process launched with the guardian env var
    /// merely INHERITED in its environment — e.g. any app/agent the guardian's
    /// ancestry spawns — must never become a guardian that trusts stdin.
    fn ambient_env_scenario() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let status = Command::new(exe)
            .env("PF_CC_ROLE", "ambient-env-probe")
            .env(pickforge_core::GUARDIAN_ENV, "stale-inherited-token")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .status()
            .map_err(|e| format!("spawn probe: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "env-var-only launch reported guardian activation ({status})"
            ))
        }
    }

    struct TempDir(PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn run_scenario(mode: &str) -> Result<(), String> {
        let dir = TempDir(
            std::env::temp_dir().join(format!("pf-cc-{mode}-{}", std::process::id())),
        );
        let _ = std::fs::remove_dir_all(&dir.0);
        std::fs::create_dir_all(&dir.0).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(dir.0.join("sessions")).map_err(|e| e.to_string())?;

        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut app = Command::new(exe)
            .env("PF_CC_ROLE", "app")
            .env("PF_CC_DIR", &dir.0)
            .env("PF_CC_EXIT", mode)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("spawn app role: {e}"))?;

        let result = drive_scenario(mode, &dir.0, &mut app);
        // Always reap the app role (it may already be gone).
        let _ = app.kill();
        let _ = app.wait();
        result
    }

    fn drive_scenario(mode: &str, dir: &Path, app: &mut Child) -> Result<(), String> {
        wait_for(Duration::from_secs(15), || dir.join("ready").exists())
            .map_err(|_| "app role never became ready".to_string())?;
        let root = read_pid(&dir.join("root.pid"))?;
        let grand = read_pid(&dir.join("grand.pid"))?;
        if !process_exists(root) || !process_exists(grand) {
            return Err("owned tree died before the crash was induced".to_string());
        }

        match mode {
            "sigterm" => signal(app.id(), libc::SIGTERM),
            "sigkill" => signal(app.id(), libc::SIGKILL),
            // exit/panic/abort: ack the alive check; the app then dies on its own.
            _ => {
                std::fs::write(dir.join("go"), b"1").map_err(|e| format!("write go: {e}"))?;
            }
        }
        let _ = app.wait();

        // The guardian sees pipe EOF and must contain the exact owned tree:
        // the direct child AND the forked grandchild.
        wait_for(Duration::from_secs(15), || {
            !process_exists(root) && !process_exists(grand)
        })
        .map_err(|_| {
            // Leave no stragglers behind a failed assertion.
            signal(root, libc::SIGKILL);
            signal(grand, libc::SIGKILL);
            format!(
                "owned tree survived {mode}: root alive={} grandchild alive={}",
                process_exists(root),
                process_exists(grand)
            )
        })
    }

    fn read_pid(path: &Path) -> Result<u32, String> {
        std::fs::read_to_string(path)
            .map_err(|e| format!("read {}: {e}", path.display()))?
            .trim()
            .parse()
            .map_err(|e| format!("parse {}: {e}", path.display()))
    }

    fn process_exists(pid: u32) -> bool {
        // kill(pid, 0) also reports zombies as "existing" until reaped by init;
        // treat a zombie as gone (its tree cannot run) by checking state on
        // Linux and falling back to signal-0 elsewhere.
        #[cfg(target_os = "linux")]
        {
            match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
                Ok(stat) => stat
                    .rsplit_once(") ")
                    .and_then(|(_, fields)| fields.split_whitespace().next())
                    .map(|state| state != "Z")
                    .unwrap_or(false),
                Err(_) => false,
            }
        }
        #[cfg(not(target_os = "linux"))]
        unsafe {
            libc::kill(pid as libc::pid_t, 0) == 0
        }
    }

    fn signal(pid: u32, signal: libc::c_int) {
        // SAFETY: signalling an exact pid we spawned/tracked; ESRCH is harmless.
        unsafe {
            libc::kill(pid as libc::pid_t, signal);
        }
    }

    fn wait_for(timeout: Duration, mut condition: impl FnMut() -> bool) -> Result<(), ()> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if condition() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        if condition() {
            Ok(())
        } else {
            Err(())
        }
    }
}

fn main() {
    #[cfg(unix)]
    unix::main();
}
