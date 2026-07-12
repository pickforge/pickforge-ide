//! Per-chat session recovery: back a chat's shell with a detachable session so a
//! running agent survives the pane closing and the app restarting.
//!
//! Two backends sit in front of the same interactive `$SHELL`:
//!
//! * **dtach** (default) — the lightest option. `dtach` runs the shell inside a
//!   tiny session bound to a Unix socket; closing the pane just detaches the
//!   client (the shell keeps running), and reopening re-attaches to the live
//!   session. We always invoke with `-A`, which means *attach if the socket is
//!   live, else create-and-attach* — one command covers both open paths and
//!   sidesteps a check-then-create race when two panes open the same chat at
//!   once.
//! * **tmux** (per-chat option) — a named session on a PickForge-OWNED tmux
//!   server (`-L pickforge`, never the user's default server). `new-session -A`
//!   is likewise attach-or-create. We turn on `set-titles` so the agent's OSC 2
//!   title still propagates out for the chat-title flow.
//!
//! When the chosen backend isn't on `PATH` we fall back to a RAW shell (today's
//! behaviour) so the terminal always works — only the recovery is lost.
//!
//! This module builds the *invocation* (program + args) and resolves the socket
//! path / session name; spawning it through `portable-pty` is the caller's job
//! (`PtyManager::spawn_chat`). Keeping the command construction pure makes it
//! unit-testable without a live dtach/tmux.

use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use super::shell::{resolve_shell, ShellInvocation};
use crate::process::{is_binary_on_path, run_timeout, user_shell_environment};

static TMUX_SERVER_NAME: LazyLock<String> = LazyLock::new(|| {
    format!(
        "pickforge-{}-{:016x}",
        std::process::id(),
        rand::random::<u64>()
    )
});

fn tmux_server_name() -> &'static str {
    &TMUX_SERVER_NAME
}

/// Which session backend a chat shell is run under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionBackend {
    /// `dtach` — the default detachable session.
    Dtach,
    /// A named session on PickForge's private `tmux` server.
    Tmux,
    /// No session layer — a plain interactive shell (today's behaviour). Used
    /// when the requested backend isn't installed.
    Raw,
}

impl SessionBackend {
    /// The stable wire tag stored in `Chat.session_id` (`"<tag>:<name>"`) and
    /// sent across IPC.
    pub fn tag(self) -> &'static str {
        match self {
            SessionBackend::Dtach => "dtach",
            SessionBackend::Tmux => "tmux",
            SessionBackend::Raw => "raw",
        }
    }

    /// Parse a wire tag back to a backend. Unknown tags resolve to `Raw`.
    pub fn from_tag(tag: &str) -> SessionBackend {
        match tag {
            "dtach" => SessionBackend::Dtach,
            "tmux" => SessionBackend::Tmux,
            _ => SessionBackend::Raw,
        }
    }

    /// The binary this backend needs on `PATH` (None for `Raw`).
    fn binary(self) -> Option<&'static str> {
        match self {
            SessionBackend::Dtach => Some("dtach"),
            SessionBackend::Tmux => Some("tmux"),
            SessionBackend::Raw => None,
        }
    }
}

/// Pick the backend to actually use: the requested one if its binary is on the
/// resolved login-shell `PATH`, else `Raw` (graceful degradation). `Raw` always
/// resolves to `Raw`.
pub fn select_backend(requested: SessionBackend) -> SessionBackend {
    select_backend_with(requested, |bin| {
        is_binary_on_path(bin, user_shell_environment())
    })
}

/// Testable core of [`select_backend`]: `present` reports whether a binary is on
/// `PATH`.
pub fn select_backend_with(
    requested: SessionBackend,
    present: impl Fn(&str) -> bool,
) -> SessionBackend {
    if requested == SessionBackend::Dtach && !cfg!(target_os = "linux") {
        return SessionBackend::Raw;
    }
    match requested.binary() {
        Some(bin) if present(bin) => requested,
        Some(_) => SessionBackend::Raw, // requested backend missing — degrade
        None => SessionBackend::Raw,
    }
}

/// A stable, collision-safe session name for a chat: `pf-` + 32 hex chars
/// (128 bits) of a hash of `(project_root, chat_id)`. Hex-only — so it's a legal
/// dtach socket basename AND an exact-match-safe tmux session name (no `.`/`:`/
/// glob chars/whitespace), and short enough to keep the socket path within the
/// ~108-byte `sockaddr_un` limit.
///
/// Stability: the same (project_root, chat_id) always yields the same name, so
/// reopening a chat re-attaches to its own session across restarts. Callers pass
/// the CANONICAL project root (the spawn-gate already canonicalizes the cwd), so
/// `~/app`, `app/`, and a symlinked path don't fork separate sessions. 128 bits
/// makes a collision within a user's chats astronomically unlikely.
pub fn session_name(project_root: &str, chat_id: &str) -> String {
    let mut hasher = Fnv1a128::new();
    hasher.write(project_root.as_bytes());
    hasher.write(&[0]); // domain separator so ("ab","c") != ("a","bc")
    hasher.write(chat_id.as_bytes());
    format!("pf-{:032x}", hasher.finish())
}

/// The directory holding dtach sockets: `<runtime_base>/pickforge/sessions/`.
/// `runtime_base` is `$XDG_RUNTIME_DIR` (a user-private dir per the XDG spec),
/// falling back to the system temp dir; the caller is responsible for creating
/// + tightening it to `0700` before binding a socket inside (mirrors the MCP
/// runtime dir handling).
pub fn sessions_dir(runtime_base: &Path) -> PathBuf {
    runtime_base.join("pickforge").join("sessions")
}

/// The dtach socket path for a session: `<sessions_dir>/<name>.dtach`.
pub fn dtach_socket_path(runtime_base: &Path, name: &str) -> PathBuf {
    sessions_dir(runtime_base).join(format!("{name}.dtach"))
}

/// Find the pid(s) of the dtach MASTER process bound to `socket` by matching its
/// argv: a master we spawned is `dtach -A <socket> …`, so the exact socket path
/// appears as one of its arguments. Matching the FULL socket path (a unique
/// `pf-<128bit-hex>.dtach` under our private sessions dir) means we never touch
/// an unrelated dtach the user is running. Linux-only (reads `/proc/<pid>/cmdline`).
///
/// dtach has no kill verb, so destroying a dtach session whose client pane is
/// already closed means signalling this master — otherwise the shell/agent inside
/// it keeps running, orphaned, once the socket is removed.
#[cfg(target_os = "linux")]
pub fn dtach_master_pids(socket: &Path) -> Vec<i32> {
    let socket_arg = socket.as_os_str().as_encoded_bytes();
    let mut pids = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return pids;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|s| s.parse::<i32>().ok()) else {
            continue; // not a /proc/<pid> dir
        };
        let Ok(cmdline) = std::fs::read(entry.path().join("cmdline")) else {
            continue; // process exited / not readable
        };
        if cmdline_is_dtach_for_socket(&cmdline, socket_arg) {
            pids.push(pid);
        }
    }
    pids
}

/// True when a NUL-separated `/proc/<pid>/cmdline` is a `dtach` process (argv[0]
/// basename == `dtach`) whose argv contains the exact `socket` path. Pure so it
/// can be unit-tested without spawning a real dtach.
#[cfg(target_os = "linux")]
fn cmdline_is_dtach_for_socket(cmdline: &[u8], socket: &[u8]) -> bool {
    let mut argv = cmdline.split(|&b| b == 0).filter(|a| !a.is_empty());
    // argv[0] must be the dtach binary (match on basename so an absolute path
    // like /usr/bin/dtach still counts).
    let is_dtach = argv
        .next()
        .map(|arg0| arg0.rsplit(|&b| b == b'/').next().unwrap_or(arg0) == b"dtach")
        .unwrap_or(false);
    // …and one of its args must be exactly our socket path.
    is_dtach && argv.any(|arg| arg == socket)
}

#[cfg(not(target_os = "linux"))]
pub fn dtach_master_pids(_socket: &Path) -> Vec<i32> {
    Vec::new()
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DtachKillError {
    #[error("exact dtach ownership discovery is unsupported on this platform")]
    Unsupported,
    #[error("no owned dtach master was found for {0}")]
    MasterNotFound(String),
    #[error("failed to signal owned dtach process {pid}: {error}")]
    SignalFailed { pid: i32, error: String },
    #[error("owned dtach master is still running for {0}")]
    StillRunning(String),
}

#[cfg(target_os = "linux")]
fn proc_parent_pid(pid: i32) -> Option<i32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (_, fields) = stat.rsplit_once(") ")?;
    fields.split_whitespace().nth(1)?.parse().ok()
}

#[cfg(target_os = "linux")]
fn descendant_pids(roots: &[i32]) -> Vec<i32> {
    let mut children: std::collections::HashMap<i32, Vec<i32>> =
        std::collections::HashMap::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<i32>().ok())
        else {
            continue;
        };
        if let Some(parent) = proc_parent_pid(pid) {
            children.entry(parent).or_default().push(pid);
        }
    }

    let mut descendants = Vec::new();
    let mut pending = roots.to_vec();
    while let Some(parent) = pending.pop() {
        if let Some(found) = children.get(&parent) {
            for &pid in found {
                if !roots.contains(&pid) && !descendants.contains(&pid) {
                    descendants.push(pid);
                    pending.push(pid);
                }
            }
        }
    }
    descendants
}

#[cfg(target_os = "linux")]
fn signal_dtach_pid(pid: i32, signal: libc::c_int) -> Result<(), DtachKillError> {
    if unsafe { libc::kill(pid, signal) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(DtachKillError::SignalFailed {
            pid,
            error: error.to_string(),
        })
    }
}

#[cfg(target_os = "linux")]
fn dtach_socket_is_stale(socket: &Path) -> bool {
    use std::os::unix::fs::FileTypeExt;

    let Ok(metadata) = std::fs::symlink_metadata(socket) else {
        return true;
    };
    if !metadata.file_type().is_socket() {
        return false;
    }
    matches!(
        std::os::unix::net::UnixStream::connect(socket),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
            )
    )
}

#[cfg(target_os = "linux")]
pub fn kill_dtach_master(socket: &Path) -> Result<usize, DtachKillError> {
    let masters = dtach_master_pids(socket);
    if masters.is_empty() {
        return if dtach_socket_is_stale(socket) {
            Ok(0)
        } else {
            Err(DtachKillError::MasterNotFound(socket.display().to_string()))
        };
    }
    let mut targets = descendant_pids(&masters);
    targets.extend(masters);
    for &pid in &targets {
        signal_dtach_pid(pid, libc::SIGTERM)?;
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    for &pid in &targets {
        signal_dtach_pid(pid, libc::SIGKILL)?;
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
    while !dtach_master_pids(socket).is_empty() {
        if std::time::Instant::now() >= deadline {
            return Err(DtachKillError::StillRunning(socket.display().to_string()));
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    Ok(targets.len())
}

#[cfg(not(target_os = "linux"))]
pub fn kill_dtach_master(_socket: &Path) -> Result<usize, DtachKillError> {
    Err(DtachKillError::Unsupported)
}

/// A resolved program + args ready to hand to `portable-pty`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInvocation {
    pub program: String,
    pub args: Vec<String>,
}

/// Build the dtach invocation that attaches-or-creates a chat session and runs
/// the user's `$SHELL` inside it.
///
/// `dtach -A <socket> -E -z -r winch <shell> [args…]`:
/// * `-A` attach if the socket is live, else create-and-attach — one race-free
///   command for both the create and the resume path. dtach 0.8+ also detects +
///   clears a stale socket here, so a crashed prior session self-heals.
/// * `-E` disables the detach character (`^\`), so the embedded terminal never
///   eats that keystroke; we detach purely by closing the client pty.
/// * `-z` disables the suspend key, so `^Z` reaches the shell's job control
///   instead of backgrounding the dtach client.
/// * `-r winch` redraws by sending SIGWINCH on attach, so the resumed shell
///   repaints to the new pane size.
pub fn dtach_invocation(socket: &Path, shell: &ShellInvocation) -> SessionInvocation {
    let mut args = vec![
        "-A".to_string(),
        socket.to_string_lossy().into_owned(),
        "-E".to_string(),
        "-z".to_string(),
        "-r".to_string(),
        "winch".to_string(),
        shell.program.clone(),
    ];
    args.extend(shell.args.iter().cloned());
    SessionInvocation {
        program: "dtach".to_string(),
        args,
    }
}

/// Build the tmux invocation that attaches-or-creates a named session on
/// PickForge's private server and runs `$SHELL` inside it.
///
/// Each app process uses a distinct private tmux server, so closing one
/// PickForge instance cannot terminate another instance's chats.
/// * `new-session -A` attaches to `<name>` if it exists, else creates it.
/// * `-c <cwd>` sets the new session's working directory (ignored on attach).
///
/// `set-titles` is configured separately via [`tmux_set_titles_args`] right
/// after the server first comes up, so the agent's OSC 2 title flows out for the
/// chat-title pipeline.
pub fn tmux_invocation(
    name: &str,
    cwd: Option<&str>,
    shell: &ShellInvocation,
) -> SessionInvocation {
    let mut args = vec![
        "-L".to_string(),
        tmux_server_name().to_string(),
        "new-session".to_string(),
        "-A".to_string(),
        "-s".to_string(),
        name.to_string(),
    ];
    if let Some(cwd) = cwd.filter(|c| !c.is_empty()) {
        args.push("-c".to_string());
        args.push(cwd.to_string());
    }
    args.push(shell.program.clone());
    args.extend(shell.args.iter().cloned());
    SessionInvocation {
        program: "tmux".to_string(),
        args,
    }
}

/// Configure title propagation on this PickForge process's private tmux server.
///
/// `set-titles on` enables emitting the terminal title; `set-titles-string '#T'`
/// makes the emitted title the active pane's own title (`#T`), i.e. exactly what
/// the agent set via OSC 2, with no tmux decoration.
pub fn tmux_set_titles_args() -> Vec<Vec<String>> {
    // `-gq`: global + quiet, so re-running it on every chat open is a harmless
    // idempotent no-op even when the option is already set (and it never errors
    // if the server is mid-startup).
    vec![
        vec![
            "-L".to_string(),
            tmux_server_name().to_string(),
            "set-option".to_string(),
            "-gq".to_string(),
            "set-titles".to_string(),
            "on".to_string(),
        ],
        vec![
            "-L".to_string(),
            tmux_server_name().to_string(),
            "set-option".to_string(),
            "-gq".to_string(),
            "set-titles-string".to_string(),
            "#T".to_string(),
        ],
    ]
}

/// Probe an exact session on this PickForge process's private tmux server.
pub fn tmux_has_session_args(name: &str) -> Vec<String> {
    vec![
        "-L".to_string(),
        tmux_server_name().to_string(),
        "has-session".to_string(),
        "-t".to_string(),
        format!("={name}"),
    ]
}

/// Destroy an exact session on this PickForge process's private tmux server.
/// The `=` prefix prevents tmux from treating the target as a prefix or glob.
pub fn tmux_kill_session_args(name: &str) -> Vec<String> {
    vec![
        "-L".to_string(),
        tmux_server_name().to_string(),
        "kill-session".to_string(),
        "-t".to_string(),
        format!("={name}"),
    ]
}

/// Tear down only this PickForge process's private tmux server.
fn tmux_kill_server_args() -> Vec<String> {
    vec![
        "-L".to_string(),
        tmux_server_name().to_string(),
        "kill-server".to_string(),
    ]
}

/// The dtach sockets WE own inside `dir`: regular (non-symlink) `pf-*.dtach`
/// entries only. The sessions dir is already user-private (`0700`), but the
/// prefix + symlink checks keep the sweep from ever following a planted link
/// or touching a file we didn't create.
fn owned_dtach_sockets(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut sockets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let owned_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("pf-") && name.ends_with(".dtach"))
            .unwrap_or(false);
        let is_symlink = std::fs::symlink_metadata(&path)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(true);
        if owned_name && !is_symlink {
            sockets.push(path);
        }
    }
    sockets
}

/// Bound the tmux kill-server call so app exit can never hang on a wedged tmux.
const TMUX_KILL_TIMEOUT: Duration = Duration::from_secs(3);

/// Clean up exact dtach sessions and PickForge's private tmux server on exit.
#[cfg(unix)]
fn validated_sessions_dir(runtime_base: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let dir = sessions_dir(runtime_base);
    for path in [dir.parent(), Some(dir.as_path())].into_iter().flatten() {
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(dir.clone()),
            Err(error) => return Err(format!("cannot inspect {}: {error}", path.display())),
        };
        if !metadata.file_type().is_dir()
            || metadata.uid() != unsafe { libc::getuid() }
            || metadata.permissions().mode() & 0o077 != 0
        {
            return Err(format!("unsafe recoverable-session directory: {}", path.display()));
        }
    }
    Ok(dir)
}

#[cfg(not(unix))]
fn validated_sessions_dir(runtime_base: &Path) -> Result<PathBuf, String> {
    Ok(sessions_dir(runtime_base))
}

fn cleanup_owned_dtach_sockets(
    dir: &Path,
    mut kill: impl FnMut(&Path) -> Result<usize, DtachKillError>,
) -> Vec<String> {
    let mut errors = Vec::new();
    for socket in owned_dtach_sockets(dir) {
        match kill(&socket) {
            Ok(_) => {
                if let Err(error) = std::fs::remove_file(&socket) {
                    errors.push(format!("cannot remove {}: {error}", socket.display()));
                }
            }
            Err(error) => errors.push(error.to_string()),
        }
    }
    errors
}

pub fn kill_recoverable_sessions_on_exit(runtime_base: &Path) -> Result<(), String> {
    let errors = match validated_sessions_dir(runtime_base) {
        Ok(dir) => cleanup_owned_dtach_sockets(&dir, kill_dtach_master),
        Err(error) => vec![error],
    };
    let args = tmux_kill_server_args();
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let _ = run_timeout("tmux", &refs, None, None, TMUX_KILL_TIMEOUT);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// The "created" vs "attached" hint returned to the UI. Best-effort: it reflects
/// whether the session's socket/name already existed when we opened, which can
/// race a simultaneous first-open — treat it as informational, not a guarantee.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Created,
    Attached,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Created => "created",
            SessionStatus::Attached => "attached",
        }
    }
}

/// Everything the PTY layer needs to spawn a chat shell under the resolved
/// backend, plus the durable handle to persist and the open status.
#[derive(Debug, Clone)]
pub struct PreparedSession {
    /// The backend actually used after the availability probe (may be `Raw`).
    pub backend: SessionBackend,
    /// `"<backend>:<name>"`, stored in `Chat.session_id`. `None` only for `Raw`
    /// when there was no prior durable id to preserve.
    pub session_id: Option<String>,
    /// dtach/tmux invocation to spawn, or `None` for a raw interactive shell.
    pub program_override: Option<(String, Vec<String>)>,
    /// Best-effort created/attached hint.
    pub status: SessionStatus,
    /// The dtach socket path, when the backend is dtach — the caller must ensure
    /// its parent dir is a private `0700` dir before spawning.
    pub dtach_socket: Option<PathBuf>,
}

/// Build the open plan for a chat's shell under an ALREADY-SELECTED backend
/// (call [`select_backend`] first so the availability probe runs once): construct
/// the dtach/tmux invocation — or, for `Raw`, a plain interactive shell — and
/// compute the durable session id. `prior_session_id` is the id already stored on
/// the chat, if any — on a `Raw` (degraded) open we PRESERVE it rather than
/// clobbering the user's recoverable session, since the backend may return.
///
/// `socket_exists`/`tmux_session_exists` are injected so this stays pure and
/// unit-testable; the caller passes real filesystem / `tmux has-session` probes.
pub fn prepare_chat_session(
    runtime_base: &Path,
    project_root: &str,
    chat_id: &str,
    backend: SessionBackend,
    prior_session_id: Option<&str>,
    socket_exists: impl Fn(&Path) -> bool,
    tmux_session_exists: impl Fn(&str) -> bool,
) -> PreparedSession {
    let name = session_name(project_root, chat_id);
    let shell = resolve_shell();

    match backend {
        SessionBackend::Dtach => {
            let socket = dtach_socket_path(runtime_base, &name);
            let status = if socket_exists(&socket) {
                SessionStatus::Attached
            } else {
                SessionStatus::Created
            };
            PreparedSession {
                backend,
                session_id: Some(format!("dtach:{name}")),
                program_override: Some({
                    let inv = dtach_invocation(&socket, &shell);
                    (inv.program, inv.args)
                }),
                status,
                dtach_socket: Some(socket),
            }
        }
        SessionBackend::Tmux => {
            let status = if tmux_session_exists(&name) {
                SessionStatus::Attached
            } else {
                SessionStatus::Created
            };
            let cwd = if project_root.is_empty() {
                None
            } else {
                Some(project_root)
            };
            PreparedSession {
                backend,
                session_id: Some(format!("tmux:{name}")),
                program_override: Some({
                    let inv = tmux_invocation(&name, cwd, &shell);
                    (inv.program, inv.args)
                }),
                status,
                dtach_socket: None,
            }
        }
        SessionBackend::Raw => PreparedSession {
            backend,
            // Preserve any prior durable id — a raw fallback is transient
            // (the backend may return), so we must NOT wipe the recovery handle.
            session_id: prior_session_id.map(str::to_string),
            program_override: None,
            status: SessionStatus::Created,
            dtach_socket: None,
        },
    }
}

/// A tiny FNV-1a 128-bit hash — no external crate, deterministic across runs and
/// platforms. Sufficient for a per-user local session-name space (collision is
/// astronomically unlikely across a user's chats); not used for anything
/// security-sensitive.
struct Fnv1a128 {
    state: u128,
}

impl Fnv1a128 {
    const OFFSET: u128 = 0x6c62272e07bb014262b821756295c58d;
    const PRIME: u128 = 0x0000000001000000000000000000013b;

    fn new() -> Self {
        Self {
            state: Self::OFFSET,
        }
    }

    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.state ^= b as u128;
            self.state = self.state.wrapping_mul(Self::PRIME);
        }
    }

    fn finish(&self) -> u128 {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell() -> ShellInvocation {
        ShellInvocation {
            program: "/bin/zsh".to_string(),
            args: vec![],
        }
    }

    #[test]
    fn session_name_is_stable_prefixed_and_hex() {
        let a = session_name("/home/dev/app", "chat-1");
        let b = session_name("/home/dev/app", "chat-1");
        assert_eq!(a, b, "same inputs → same name");
        assert!(a.starts_with("pf-"), "carries the pf- prefix: {a}");
        let hex = &a[3..];
        assert_eq!(hex.len(), 32, "32 hex chars (128 bits) after the prefix");
        assert!(
            hex.chars().all(|c| c.is_ascii_hexdigit()),
            "name body must be hex-only (legal dtach + tmux name): {a}",
        );
        // Short enough to keep a dtach socket path inside the sockaddr_un limit.
        assert!(a.len() < 40);
    }

    #[test]
    fn session_name_distinguishes_chat_and_project() {
        let base = session_name("/home/dev/app", "chat-1");
        assert_ne!(base, session_name("/home/dev/app", "chat-2"), "chat id matters");
        assert_ne!(base, session_name("/home/dev/other", "chat-1"), "root matters");
        // The domain separator prevents (a+b, c) colliding with (a, b+c).
        assert_ne!(
            session_name("/ab", "c"),
            session_name("/a", "bc"),
            "boundary between root and chat id must not blur",
        );
    }

    #[test]
    fn dtach_invocation_attaches_or_creates_with_redraw() {
        let sock = PathBuf::from("/run/pickforge/sessions/pf-abc.dtach");
        let inv = dtach_invocation(&sock, &shell());
        assert_eq!(inv.program, "dtach");
        assert_eq!(
            inv.args,
            vec![
                "-A",
                "/run/pickforge/sessions/pf-abc.dtach",
                "-E",
                "-z",
                "-r",
                "winch",
                "/bin/zsh",
            ]
        );
    }

    #[test]
    fn dtach_invocation_keeps_shell_login_args() {
        let sock = PathBuf::from("/run/x/pf-abc.dtach");
        let login_shell = ShellInvocation {
            program: "/bin/zsh".to_string(),
            args: vec!["-l".to_string()],
        };
        let inv = dtach_invocation(&sock, &login_shell);
        // The shell + its login flag must trail the dtach flags, in order.
        assert_eq!(inv.args.last().map(String::as_str), Some("-l"));
        assert_eq!(inv.args[inv.args.len() - 2], "/bin/zsh");
    }

    #[test]
    fn tmux_invocation_uses_private_server_and_attach_or_create() {
        let inv = tmux_invocation("pf-abc", Some("/home/dev/app"), &shell());
        assert_eq!(inv.program, "tmux");
        assert_eq!(inv.args[0], "-L");
        assert_eq!(inv.args[1], tmux_server_name());
        assert_eq!(
            &inv.args[2..],
            [
                "new-session",
                "-A",
                "-s",
                "pf-abc",
                "-c",
                "/home/dev/app",
                "/bin/zsh",
            ]
        );
    }

    #[test]
    fn tmux_invocation_omits_empty_cwd() {
        let inv = tmux_invocation("pf-abc", None, &shell());
        assert!(!inv.args.iter().any(|a| a == "-c"), "no -c without a cwd");
        let inv2 = tmux_invocation("pf-abc", Some(""), &shell());
        assert!(!inv2.args.iter().any(|a| a == "-c"), "empty cwd is dropped");
    }

    #[test]
    fn tmux_set_titles_targets_private_server_and_passes_osc_through() {
        let cmds = tmux_set_titles_args();
        assert_eq!(cmds.len(), 2);
        for c in &cmds {
            assert_eq!(&c[0], "-L");
            assert_eq!(&c[1], tmux_server_name());
            assert_eq!(&c[2], "set-option");
            assert_eq!(&c[3], "-gq"); // global + quiet → idempotent re-runs
        }
        assert_eq!(cmds[0][4], "set-titles");
        assert_eq!(cmds[0][5], "on");
        assert_eq!(cmds[1][4], "set-titles-string");
        assert_eq!(cmds[1][5], "#T"); // emit the pane's own (agent-set) title
    }

    #[test]
    fn tmux_kill_targets_the_named_session_exactly_on_the_private_server() {
        let args = tmux_kill_session_args("pf-abc");
        assert_eq!(args[0], "-L");
        assert_eq!(args[1], tmux_server_name());
        assert_eq!(&args[2..], ["kill-session", "-t", "=pf-abc"]);
    }

    #[test]
    fn tmux_kill_server_targets_only_the_private_server() {
        let args = tmux_kill_server_args();
        assert_eq!(args, vec!["-L", tmux_server_name(), "kill-server"]);
        assert!(tmux_server_name().starts_with("pickforge-"));
    }

    #[cfg(unix)]
    #[test]
    fn owned_dtach_socket_sweep_matches_only_our_regular_files() {
        use std::os::unix::fs::symlink;

        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-dtach-sweep-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create sweep dir");

        // Ours: a regular pf-*.dtach file.
        let ours = dir.join("pf-abc123.dtach");
        std::fs::write(&ours, b"").expect("write owned socket");
        // Not ours: wrong prefix, wrong suffix, and a planted symlink that
        // resolves to a pf-named path — the sweep must skip all three.
        std::fs::write(dir.join("other.dtach"), b"").expect("write foreign socket");
        std::fs::write(dir.join("pf-abc123.sock"), b"").expect("write wrong suffix");
        symlink(&ours, dir.join("pf-planted.dtach")).expect("plant symlink");

        assert_eq!(owned_dtach_sockets(&dir), vec![ours]);

        // A missing dir is an empty (not panicking) sweep.
        let _ = std::fs::remove_dir_all(&dir);
        assert!(owned_dtach_sockets(&dir).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn exit_cleanup_rejects_an_insecure_sessions_directory() {
        use std::os::unix::fs::PermissionsExt;

        let base = std::env::temp_dir().join(format!(
            "pickforge-dtach-dir-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let app_dir = base.join("pickforge");
        let dir = app_dir.join("sessions");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&app_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(validated_sessions_dir(&base).is_err());

        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn exit_cleanup_preserves_socket_when_master_is_not_identifiable() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "pickforge-dtach-unmatched-{}-{nonce}",
            std::process::id()
        ));
        let dir = sessions_dir(&base);
        std::fs::create_dir_all(&dir).expect("create sessions dir");
        let socket = dir.join("pf-unmatched.dtach");
        std::fs::write(&socket, b"").expect("write fake socket");

        let errors = cleanup_owned_dtach_sockets(&dir, |path| {
            Err(DtachKillError::MasterNotFound(path.display().to_string()))
        });

        assert!(errors.join("; ").contains("no owned dtach master"));
        assert!(socket.exists(), "unmatched socket must not be unlinked");
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn exit_cleanup_removes_a_stale_owned_socket() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "pickforge-dtach-stale-{}-{nonce}",
            std::process::id()
        ));
        let dir = sessions_dir(&base);
        std::fs::create_dir_all(&dir).expect("create sessions dir");
        let socket = dir.join("pf-stale.dtach");
        let listener =
            std::os::unix::net::UnixListener::bind(&socket).expect("bind stale socket");
        drop(listener);

        let errors = cleanup_owned_dtach_sockets(&dir, kill_dtach_master);

        assert!(errors.is_empty(), "{errors:?}");
        assert!(!socket.exists(), "stale socket must be removed");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn backend_selection_falls_back_to_raw_when_absent() {
        // dtach is selected only where exact owned-process discovery is supported.
        assert_eq!(
            select_backend_with(SessionBackend::Dtach, |b| b == "dtach"),
            if cfg!(target_os = "linux") {
                SessionBackend::Dtach
            } else {
                SessionBackend::Raw
            }
        );
        // dtach requested but only tmux present → degrade to raw.
        assert_eq!(
            select_backend_with(SessionBackend::Dtach, |b| b == "tmux"),
            SessionBackend::Raw
        );
        // tmux present → tmux.
        assert_eq!(
            select_backend_with(SessionBackend::Tmux, |b| b == "tmux"),
            SessionBackend::Tmux
        );
        // nothing present → raw.
        assert_eq!(
            select_backend_with(SessionBackend::Tmux, |_| false),
            SessionBackend::Raw
        );
        // raw is always raw, regardless of what's on PATH.
        assert_eq!(
            select_backend_with(SessionBackend::Raw, |_| true),
            SessionBackend::Raw
        );
    }

    #[test]
    fn backend_tag_round_trips() {
        for b in [SessionBackend::Dtach, SessionBackend::Tmux, SessionBackend::Raw] {
            assert_eq!(SessionBackend::from_tag(b.tag()), b);
        }
        assert_eq!(SessionBackend::from_tag("bogus"), SessionBackend::Raw);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn dtach_cmdline_matcher_is_exact_and_safe() {
        // Build a NUL-separated argv blob like /proc/<pid>/cmdline (trailing NUL).
        fn cmdline(args: &[&str]) -> Vec<u8> {
            let mut v = Vec::new();
            for a in args {
                v.extend_from_slice(a.as_bytes());
                v.push(0);
            }
            v
        }
        let sock = b"/run/user/1000/pickforge/sessions/pf-abc.dtach" as &[u8];

        // Our master, with an absolute dtach path → matched.
        assert!(cmdline_is_dtach_for_socket(
            &cmdline(&[
                "/usr/bin/dtach", "-A",
                "/run/user/1000/pickforge/sessions/pf-abc.dtach",
                "-E", "-z", "-r", "winch", "/bin/zsh",
            ]),
            sock,
        ));
        // Bare `dtach` (no path) → matched on basename.
        assert!(cmdline_is_dtach_for_socket(
            &cmdline(&["dtach", "-A", "/run/user/1000/pickforge/sessions/pf-abc.dtach", "/bin/zsh"]),
            sock,
        ));
        // A DIFFERENT socket (even a prefix of ours) must NOT match.
        assert!(!cmdline_is_dtach_for_socket(
            &cmdline(&["dtach", "-A", "/run/user/1000/pickforge/sessions/pf-abcd.dtach", "/bin/zsh"]),
            sock,
        ));
        // A non-dtach process that merely has the socket path in its args (e.g. an
        // editor opening the file) must NOT match.
        assert!(!cmdline_is_dtach_for_socket(
            &cmdline(&["nvim", "/run/user/1000/pickforge/sessions/pf-abc.dtach"]),
            sock,
        ));
        // Empty / malformed cmdline must not match.
        assert!(!cmdline_is_dtach_for_socket(&[], sock));
    }

    #[test]
    fn socket_path_is_under_the_sessions_dir() {
        let base = PathBuf::from("/run/user/1000");
        let p = dtach_socket_path(&base, "pf-abc");
        assert_eq!(
            p,
            PathBuf::from("/run/user/1000/pickforge/sessions/pf-abc.dtach")
        );
    }

    #[test]
    fn prepare_dtach_reports_created_then_attached() {
        let base = PathBuf::from("/run/user/1000");
        // Socket absent → created.
        let p = prepare_chat_session(
            &base, "/app", "chat-1", SessionBackend::Dtach, None,
            |_| false, |_| false,
        );
        assert_eq!(p.backend, SessionBackend::Dtach);
        assert_eq!(p.status, SessionStatus::Created);
        assert!(p.session_id.as_deref().unwrap().starts_with("dtach:pf-"));
        let (prog, _) = p.program_override.as_ref().unwrap();
        assert_eq!(prog, "dtach");
        assert!(p.dtach_socket.is_some());

        // Socket present → attached, same durable id.
        let p2 = prepare_chat_session(
            &base, "/app", "chat-1", SessionBackend::Dtach, None,
            |_| true, |_| false,
        );
        assert_eq!(p2.status, SessionStatus::Attached);
        assert_eq!(p2.session_id, p.session_id, "stable across opens");
    }

    #[test]
    fn prepare_tmux_uses_name_and_attach_status() {
        let base = PathBuf::from("/run/user/1000");
        let created = prepare_chat_session(
            &base, "/app", "chat-1", SessionBackend::Tmux, None,
            |_| false, |_| false,
        );
        assert_eq!(created.backend, SessionBackend::Tmux);
        assert_eq!(created.status, SessionStatus::Created);
        assert!(created.session_id.as_deref().unwrap().starts_with("tmux:pf-"));
        assert!(created.dtach_socket.is_none());
        let (prog, args) = created.program_override.as_ref().unwrap();
        assert_eq!(prog, "tmux");
        assert!(args.iter().any(|a| a == "new-session"));

        let attached = prepare_chat_session(
            &base, "/app", "chat-1", SessionBackend::Tmux, None,
            |_| false, |_| true,
        );
        assert_eq!(attached.status, SessionStatus::Attached);
    }

    #[test]
    fn prepare_raw_fallback_preserves_a_prior_session_id() {
        let base = PathBuf::from("/run/user/1000");
        // `Raw` requested (or a degraded backend) must keep the recoverable id so
        // a temporarily-missing dtach/tmux doesn't wipe the user's session.
        let p = prepare_chat_session(
            &base, "/app", "chat-1", SessionBackend::Raw, Some("dtach:pf-keepme"),
            |_| true, |_| true,
        );
        assert_eq!(p.backend, SessionBackend::Raw);
        assert!(p.program_override.is_none(), "raw = plain interactive shell");
        assert_eq!(p.session_id.as_deref(), Some("dtach:pf-keepme"));
        assert_eq!(p.status, SessionStatus::Created);

        // …and with no prior id, raw simply has none.
        let none = prepare_chat_session(
            &base, "/app", "chat-1", SessionBackend::Raw, None,
            |_| false, |_| false,
        );
        assert!(none.session_id.is_none());
    }
}
