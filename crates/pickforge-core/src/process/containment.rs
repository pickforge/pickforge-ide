//! Local crash containment (#208 PR 2): guarantee that PickForge-owned LOCAL
//! process trees die even when the main process dies abruptly (panic, abort,
//! SIGTERM, SIGKILL) and the PR 1 graceful teardown never runs.
//!
//! Ownership contract: PR 1 already makes every launcher spawn owned children
//! as process-group leaders and tear them down on confirmed exit. This module
//! adds the abrupt-death backstop:
//!
//! * **Unix** — the app starts a GUARDIAN child at boot: its own executable
//!   re-executed with the [`GUARDIAN_ARG`] argv sentinel plus a one-time
//!   secret token in [`GUARDIAN_ENV`], holding the read end of a private
//!   pipe. Activation needs BOTH (never the env var alone), the guardian
//!   only trusts stdin whose first line authenticates with the token, and
//!   free-form fields are newline-escaped so hostile paths cannot forge
//!   protocol records. Every owned process-tree ROOT is registered over that pipe as an
//!   exact `pid + birth start-time` identity. The guardian does nothing while
//!   the app lives; when the pipe reaches EOF — which the kernel delivers for
//!   normal exit, panic, abort, SIGTERM, and SIGKILL alike — it terminates the
//!   still-live registered trees by exact identity (never by name), sweeps the
//!   dead instance's private dtach/tmux recoverable sessions, and exits.
//! * **Windows** — no guardian: owned roots are assigned to one kill-on-close
//!   Job Object whose only handle lives in the app process, so any
//!   main-process death makes the kernel kill every assigned tree.
//!
//! Registration is idempotent and append-only. Identities are captured at
//! spawn time and re-validated before every signal, so PID reuse can never
//! redirect the sweep at an unrelated process, and roots that already exited
//! are skipped. The only known gap is the instant between a child's spawn and
//! its registration write; guardian-owned spawning to close it is future work.
//!
//! Default-off: the gate is the startup-safe `PICKFORGE_LOCAL_CRASH_CONTAINMENT`
//! environment variable (compiled default off), because the guardian must start
//! before any frontend/flag state exists.

#[cfg(unix)]
use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(any(unix, windows))]
use std::sync::OnceLock;

/// Carries the one-time auth token minted by the spawning parent for the
/// guardian child. NEVER an activation trigger on its own: guardian mode also
/// requires the [`GUARDIAN_ARG`] argv sentinel, so an inherited env var alone
/// can never hijack a normal launch into guardian mode. The guardian clears
/// it immediately on read.
pub const GUARDIAN_ENV: &str = "PICKFORGE_CONTAINMENT_GUARDIAN";
/// Argv sentinel the spawning parent passes as the FIRST argument of the
/// guardian re-exec. Required alongside [`GUARDIAN_ENV`] for activation.
pub const GUARDIAN_ARG: &str = "--pickforge-containment-guardian";
const ENABLE_ENV: &str = "PICKFORGE_LOCAL_CRASH_CONTAINMENT";

/// Whether local crash containment is enabled for this launch. Compiled
/// default: off. `PICKFORGE_LOCAL_CRASH_CONTAINMENT` set to anything except
/// `""`/`"0"`/`"false"` opts in.
pub fn local_crash_containment_enabled() -> bool {
    std::env::var(ENABLE_ENV)
        .map(|value| flag_enabled(&value))
        .unwrap_or(false)
}

fn flag_enabled(value: &str) -> bool {
    !matches!(value.trim(), "" | "0" | "false")
}

/// True when this process was launched as the containment guardian and must
/// call [`guardian_main`] instead of running the app. Activation is
/// non-ambient: it requires BOTH the [`GUARDIAN_ARG`] argv sentinel (which
/// only the spawning parent passes) and the [`GUARDIAN_ENV`] token, so an
/// env var inherited by an unrelated child can never trigger guardian mode.
pub fn guardian_requested() -> bool {
    guardian_activation(
        std::env::args_os().nth(1).as_deref(),
        std::env::var_os(GUARDIAN_ENV).is_some(),
    )
}

fn guardian_activation(first_arg: Option<&std::ffi::OsStr>, token_present: bool) -> bool {
    token_present && first_arg == Some(std::ffi::OsStr::new(GUARDIAN_ARG))
}

/// Non-secret context the guardian needs to sweep a dead instance's
/// recoverable sessions: the instance-private sessions dir, the
/// instance-private tmux server name, and the resolved tmux binary (the
/// guardian inherits the app's raw env, not the login-shell PATH).
#[derive(Debug, Clone, Default)]
pub struct ContainmentContext {
    pub sessions_dir: Option<PathBuf>,
    pub tmux_server: Option<String>,
    pub tmux_program: Option<PathBuf>,
}

#[cfg(unix)]
static GUARDIAN_PIPE: OnceLock<std::sync::Mutex<std::process::ChildStdin>> = OnceLock::new();

#[cfg(windows)]
static CONTAINMENT_JOB: OnceLock<isize> = OnceLock::new();

/// Start the containment layer. Unix: spawn the guardian (this executable with
/// the [`GUARDIAN_ARG`] sentinel and a one-time token in [`GUARDIAN_ENV`]) in
/// its own process group and hand it the context.
/// Idempotent — a second call is a no-op.
#[cfg(unix)]
pub fn start_local_crash_containment(ctx: &ContainmentContext) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    if GUARDIAN_PIPE.get().is_some() {
        return Ok(());
    }
    let exe = std::env::current_exe()?;
    // One-time secret: proves to the guardian that its stdin pipe belongs to
    // the parent that spawned it, before any ownership command is trusted.
    let token = format!("{:032x}", rand::random::<u128>());
    let mut command = Command::new(exe);
    command
        .arg(GUARDIAN_ARG)
        .env(GUARDIAN_ENV, &token)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        // Own group: signals aimed at the app's process group must not take
        // the guardian down with it.
        .process_group(0);
    let mut child = command.spawn()?;
    let mut stdin = child.stdin.take().expect("guardian stdin is piped");
    writeln!(stdin, "auth {token}")?;
    if let Some(dir) = ctx.sessions_dir.as_ref() {
        writeln!(
            stdin,
            "sessions-dir {}",
            escape_field(&dir.display().to_string())
        )?;
    }
    if let Some(server) = ctx.tmux_server.as_deref() {
        writeln!(stdin, "tmux-server {}", escape_field(server))?;
    }
    if let Some(program) = ctx.tmux_program.as_ref() {
        writeln!(
            stdin,
            "tmux-bin {}",
            escape_field(&program.display().to_string())
        )?;
    }
    stdin.flush()?;
    if GUARDIAN_PIPE.set(std::sync::Mutex::new(stdin)).is_err() {
        // Lost a start race: the winner's pipe stands; this spare guardian
        // sees EOF (its stdin just dropped) and exits with nothing registered.
        return Ok(());
    }
    // The guardian must OUTLIVE this process — never reap it. It exits on its
    // own after the EOF sweep and init reaps it.
    std::mem::forget(child);
    Ok(())
}

/// Start the containment layer. Windows: create one kill-on-close Job Object.
/// Its only handle lives in this process for the app's lifetime, so any
/// main-process death closes it and the kernel kills every assigned tree.
#[cfg(windows)]
pub fn start_local_crash_containment(_ctx: &ContainmentContext) -> std::io::Result<()> {
    use std::mem::{size_of, zeroed};

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    if CONTAINMENT_JOB.get().is_some() {
        return Ok(());
    }
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        if CONTAINMENT_JOB.set(job as isize).is_err() {
            CloseHandle(job);
        }
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
pub fn start_local_crash_containment(_ctx: &ContainmentContext) -> std::io::Result<()> {
    Ok(())
}

/// Best-effort registration of an owned local process-tree ROOT with the crash
/// containment layer. No-op when containment is not running. The identity
/// (pid + birth start time) is captured NOW — while the child is provably ours
/// (alive or an unreaped zombie we hold) — so later PID reuse can never
/// redirect the sweep at an unrelated process.
pub fn contain_owned_root(pid: u32) {
    #[cfg(unix)]
    {
        use std::io::Write;

        let Some(pipe) = GUARDIAN_PIPE.get() else {
            return;
        };
        let Some(start_time) = process_start_time(pid) else {
            return;
        };
        let mut stdin = match pipe.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let _ = writeln!(stdin, "own {pid} {start_time}");
        let _ = stdin.flush();
    }
    #[cfg(windows)]
    assign_to_containment_job(pid);
    #[cfg(not(any(unix, windows)))]
    let _ = pid;
}

#[cfg(windows)]
fn assign_to_containment_job(pid: u32) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    let Some(&job) = CONTAINMENT_JOB.get() else {
        return;
    };
    unsafe {
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process.is_null() {
            return;
        }
        // Nested jobs are supported since Windows 8, so children that manage
        // their own kill-on-close job (OMP/Pi) still join the app-wide net.
        let _ = AssignProcessToJobObject(job as HANDLE, process);
        CloseHandle(process);
    }
}

/// The birth identity component: the process's kernel start time. `None` when
/// the process does not exist (or the platform cannot prove identity, in which
/// case registration is refused rather than risked).
#[cfg(target_os = "linux")]
pub(crate) fn process_start_time(pid: u32) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (_, fields) = stat.rsplit_once(") ")?;
    // Field 22 (starttime) — fields after the comm start at field 3.
    fields.split_whitespace().nth(19)?.parse().ok()
}

#[cfg(target_os = "macos")]
pub(crate) fn process_start_time(pid: u32) -> Option<u64> {
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let written = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut libc::proc_bsdinfo).cast(),
            size,
        )
    };
    if written != size {
        return None;
    }
    Some(
        (info.pbi_start_tvsec as u64)
            .wrapping_mul(1_000_000)
            .wrapping_add(info.pbi_start_tvusec as u64),
    )
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
pub(crate) fn process_start_time(_pid: u32) -> Option<u64> {
    None
}

/// Everything the guardian accumulated from its stdin pipe before EOF.
#[cfg(unix)]
#[derive(Debug, Default, PartialEq)]
struct GuardianState {
    /// Owned tree roots by pid → birth start time. Append-only: entries are
    /// never released, because the sweep re-validates every identity — an
    /// exited root (or a reused pid) simply no longer matches and is skipped.
    owned: HashMap<u32, u64>,
    sessions_dir: Option<PathBuf>,
    tmux_server: Option<String>,
    tmux_program: Option<PathBuf>,
}

/// Escape a free-form field for the line-oriented pipe protocol so a value
/// containing newlines/CR (e.g. a hostile `XDG_RUNTIME_DIR` or tmux socket
/// path) can never inject a forged `own`/context record: every written line
/// stays exactly one protocol record.
#[cfg(unix)]
fn escape_field(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    for ch in field.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(unix)]
fn unescape_field(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    let mut chars = field.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

#[cfg(unix)]
fn apply_guardian_line(line: &str, state: &mut GuardianState) {
    let Some((verb, rest)) = line.split_once(' ') else {
        return;
    };
    match verb {
        "own" => {
            if let Some((pid, start_time)) = rest.split_once(' ') {
                if let (Ok(pid), Ok(start_time)) = (pid.parse(), start_time.parse()) {
                    state.owned.insert(pid, start_time);
                }
            }
        }
        "sessions-dir" => state.sessions_dir = Some(PathBuf::from(unescape_field(rest))),
        "tmux-server" => state.tmux_server = Some(unescape_field(rest)),
        "tmux-bin" => state.tmux_program = Some(PathBuf::from(unescape_field(rest))),
        _ => {}
    }
}

/// Read the guardian's whole stdin protocol. The FIRST line must be
/// `auth <token>` matching the one-time token the spawning parent minted;
/// otherwise nothing on the pipe is trusted and `None` is returned (no sweep).
#[cfg(unix)]
fn read_guardian_state(reader: impl std::io::BufRead, token: &str) -> Option<GuardianState> {
    let mut lines = reader.lines();
    match lines.next() {
        Some(Ok(line)) if line.strip_prefix("auth ") == Some(token) => {}
        _ => return None,
    }
    let mut state = GuardianState::default();
    for line in lines {
        let Ok(line) = line else { break };
        apply_guardian_line(&line, &mut state);
    }
    Some(state)
}

/// Guardian entry point. The binary must call this (and never return to the
/// app) when [`guardian_requested`] is true. Blocks reading registrations
/// until the owning process dies (pipe EOF), then contains exactly what that
/// process owned and exits.
pub fn guardian_main() -> ! {
    #[cfg(unix)]
    {
        // Take the one-time token and clear the env var immediately: it must
        // never leak into anything the sweep spawns (tmux) nor linger as an
        // ambient activation hint.
        let token = std::env::var(GUARDIAN_ENV).ok();
        std::env::remove_var(GUARDIAN_ENV);
        let stdin = std::io::stdin();
        let state = token
            .filter(|token| !token.is_empty())
            .and_then(|token| read_guardian_state(stdin.lock(), &token));
        // EOF: the owning PickForge process is gone — normal exit, panic,
        // abort, SIGTERM, or SIGKILL alike. Contain exactly what it owned —
        // but only when the pipe authenticated as the spawning parent's.
        if let Some(state) = state {
            sweep(state);
        }
    }
    std::process::exit(0)
}

#[cfg(unix)]
fn sweep(state: GuardianState) {
    sweep_owned_roots(&state.owned);
    if let Some(dir) = state.sessions_dir.as_ref() {
        if let Err(error) = crate::pty::contain_recoverable_sessions(
            dir,
            state.tmux_server.as_deref(),
            state.tmux_program.as_deref(),
        ) {
            eprintln!("pickforge guardian: recoverable session sweep incomplete: {error}");
        }
    }
}

/// Terminate every still-live owned root — and its descendants — by exact
/// identity. Linux gets the full `/proc` ancestry/session expansion shared
/// with the dtach containment path; other Unixes fall back to identity-checked
/// process-group teardown (owned roots are group leaders per the PR 1
/// contract).
#[cfg(target_os = "linux")]
fn sweep_owned_roots(owned: &HashMap<u32, u64>) {
    let roots: Vec<crate::pty::OwnedProcessIdentity> = owned
        .iter()
        .map(|(&pid, &start_time)| crate::pty::OwnedProcessIdentity {
            pid: pid as i32,
            start_time,
        })
        .collect();
    if roots.is_empty() {
        return;
    }
    if let Err(error) = crate::pty::terminate_owned_process_trees(&roots) {
        eprintln!("pickforge guardian: owned process sweep incomplete: {error}");
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
fn sweep_owned_roots(owned: &HashMap<u32, u64>) {
    let live: Vec<u32> = owned
        .iter()
        .filter(|&(&pid, &start_time)| process_start_time(pid) == Some(start_time))
        .map(|(&pid, _)| pid)
        .collect();
    if live.is_empty() {
        return;
    }
    for &pid in &live {
        signal_root_and_group(pid, libc::SIGTERM);
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    for &pid in &live {
        if process_start_time(pid) == Some(*owned.get(&pid).expect("live root came from owned")) {
            signal_root_and_group(pid, libc::SIGKILL);
        }
    }
}

/// Signal both the exact pid and its process group (owned roots are their own
/// group leaders; ESRCH on either is harmless).
#[cfg(all(unix, not(target_os = "linux")))]
fn signal_root_and_group(pid: u32, signal: libc::c_int) {
    // SAFETY: kill/killpg with a positive pid are well-defined; the identity
    // was just re-validated by birth start time.
    unsafe {
        libc::killpg(pid as libc::pid_t, signal);
        libc::kill(pid as libc::pid_t, signal);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn containment_flag_is_default_off_with_explicit_truthy_values() {
        assert!(!flag_enabled(""));
        assert!(!flag_enabled("0"));
        assert!(!flag_enabled("false"));
        assert!(!flag_enabled(" false "));
        assert!(flag_enabled("1"));
        assert!(flag_enabled("true"));
        assert!(flag_enabled("on"));
    }

    #[cfg(unix)]
    #[test]
    fn guardian_lines_register_identities_and_context_and_ignore_garbage() {
        let mut state = GuardianState::default();
        apply_guardian_line("own 41 1234", &mut state);
        apply_guardian_line("own 41 5678", &mut state); // pid reuse: latest wins
        apply_guardian_line("own 99 7", &mut state);
        apply_guardian_line("sessions-dir /run/user/1000/pickforge/s 1", &mut state);
        apply_guardian_line("tmux-server pickforge-1a2b-cafe", &mut state);
        apply_guardian_line("tmux-bin /usr/local/bin/tmux", &mut state);
        apply_guardian_line("own not-a-pid 1", &mut state);
        apply_guardian_line("own 7", &mut state);
        apply_guardian_line("release 41 5678", &mut state);
        apply_guardian_line("", &mut state);
        apply_guardian_line("garbage", &mut state);

        assert_eq!(state.owned.get(&41), Some(&5678));
        assert_eq!(state.owned.get(&99), Some(&7));
        assert_eq!(state.owned.len(), 2);
        assert_eq!(
            state.sessions_dir.as_deref(),
            Some(std::path::Path::new("/run/user/1000/pickforge/s 1"))
        );
        assert_eq!(state.tmux_server.as_deref(), Some("pickforge-1a2b-cafe"));
        assert_eq!(
            state.tmux_program.as_deref(),
            Some(std::path::Path::new("/usr/local/bin/tmux"))
        );
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn birth_identity_is_stable_for_a_live_child_and_gone_after_reap() {
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .stdin(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        let start_time = process_start_time(pid).expect("live child has a birth identity");
        assert_eq!(
            process_start_time(pid),
            Some(start_time),
            "identity must be stable while the child lives"
        );
        let _ = child.kill();
        let _ = child.wait();
        // Reaped: the pid no longer names our child. Either the entry is gone
        // or (rare instant reuse) it names a process we must not treat as ours.
        if let Some(current) = process_start_time(pid) {
            assert!(
                current >= start_time,
                "a reused pid can never predate the reaped child"
            );
        }
    }

    #[test]
    fn guardian_activation_requires_argv_sentinel_and_token_together() {
        let arg = std::ffi::OsStr::new(GUARDIAN_ARG);
        // Inherited env var alone (any argv) must NEVER activate guardian mode.
        assert!(!guardian_activation(None, true));
        assert!(!guardian_activation(Some(std::ffi::OsStr::new("pick.pf")), true));
        // Sentinel without the token is not a parent-authenticated launch.
        assert!(!guardian_activation(Some(arg), false));
        assert!(!guardian_activation(None, false));
        // Only the exact pair the spawning parent passes activates.
        assert!(guardian_activation(Some(arg), true));
    }

    #[cfg(unix)]
    #[test]
    fn newline_bearing_fields_cannot_forge_ownership_records() {
        // A hostile XDG_RUNTIME_DIR-style path embedding protocol lines.
        let evil = "/run/user/1000\nown 4242 1\nsessions-dir /tmp/forged";
        let mut state = GuardianState::default();
        apply_guardian_line(&format!("sessions-dir {}", escape_field(evil)), &mut state);
        // One line in, one record out: the payload stays an inert path value.
        assert!(state.owned.is_empty(), "forged own record must not register");
        assert_eq!(state.sessions_dir.as_deref(), Some(std::path::Path::new(evil)));

        let cr = "pickforge\r\nown 7 7\\srv";
        assert_eq!(unescape_field(&escape_field(cr)), cr, "escape must round-trip");
        let mut state = GuardianState::default();
        apply_guardian_line(&format!("tmux-server {}", escape_field(cr)), &mut state);
        assert!(state.owned.is_empty());
        assert_eq!(state.tmux_server.as_deref(), Some(cr));
    }

    #[cfg(unix)]
    #[test]
    fn guardian_state_is_only_read_from_an_authenticated_pipe() {
        use std::io::BufReader;

        let token = "deadbeefcafe";
        let good = format!("auth {token}\nown 41 1234\ntmux-server srv\n");
        let state = read_guardian_state(BufReader::new(good.as_bytes()), token)
            .expect("authenticated pipe is trusted");
        assert_eq!(state.owned.get(&41), Some(&1234));
        assert_eq!(state.tmux_server.as_deref(), Some("srv"));

        // Wrong or missing token: nothing on the pipe is trusted — no sweep.
        let forged = "auth wrong\nown 41 1234\n";
        assert_eq!(
            read_guardian_state(BufReader::new(forged.as_bytes()), token),
            None
        );
        let unauthenticated = "own 41 1234\n";
        assert_eq!(
            read_guardian_state(BufReader::new(unauthenticated.as_bytes()), token),
            None
        );
        assert_eq!(read_guardian_state(BufReader::new(&b""[..]), token), None);
    }

    #[test]
    fn contain_owned_root_without_a_guardian_is_a_no_op() {
        // No guardian was started in this process: must silently do nothing.
        contain_owned_root(std::process::id());
    }
}
