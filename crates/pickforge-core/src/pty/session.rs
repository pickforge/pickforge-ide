//! PTY session registry — spawn/read/write/resize/kill on `portable-pty`.
//!
//! Mirrors the Dart `PtyProcess` + `PtyProcessFactory` boundary. The reader runs
//! on a dedicated OS thread (portable-pty's master reader is a blocking `Read`),
//! pushing each chunk to a [`PtySink`]. The UI layer adapts that sink to its own
//! transport (a Tauri `Channel`, today).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use super::env::normalize_pty_env;
use super::shell::{resolve_shell, ShellInvocation};
use crate::process::{user_shell_environment, StartGate};
use crate::remote::{
    remote_process_command, shell_quote_argv, ssh_base_args, stop_remote_leases_bounded,
    RemoteLeaseHandle, RemoteLeasePayload, SshTarget,
};

const PTY_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Events emitted by a running PTY session.
#[derive(Debug, Clone)]
pub enum PtyEvent {
    /// A chunk of raw bytes read from the pty master.
    Output(Vec<u8>),
    /// The shell exited (EOF on the master). `code` is best-effort. For remote
    /// SSH PTYs, `255` means SSH transport/auth failure; remote command exits
    /// keep their normal status.
    Exit(Option<i32>),
}

/// Anything that can receive [`PtyEvent`]s. Implemented for any matching closure
/// so callers can pass `move |evt| { ... }` without a newtype.
pub trait PtySink: Send + Sync + 'static {
    fn emit(&self, event: PtyEvent);
}

impl<F> PtySink for F
where
    F: Fn(PtyEvent) + Send + Sync + 'static,
{
    fn emit(&self, event: PtyEvent) {
        self(event)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePty {
    pub host: String,
    pub remote_root: String,
    pub remote_process_leases: bool,
}

/// Options for spawning a shell. `rows`/`cols` of 0 default to 24×80.
#[derive(Debug, Clone, Default)]
pub struct SpawnOptions {
    /// Local working directory for non-remote spawns. Remote PTYs ignore this;
    /// `remote_root` handles the remote `cd`.
    pub cwd: Option<String>,
    pub rows: u16,
    pub cols: u16,
    /// Extra environment merged on top of the normalised login-shell env —
    /// the `PICKFORGE_*` vars (and an IPC endpoint) go here. Remote PTYs apply
    /// this only to the local `ssh` client; this slice does not forward env to
    /// the remote shell.
    pub extra_env: HashMap<String, String>,
    /// When set, run this command (`$SHELL -c <command>`) once and exit, instead
    /// of an interactive shell. The Debug Console uses this so a finished run
    /// leaves its output behind rather than dropping to a live shell prompt.
    /// MUTUALLY EXCLUSIVE with `program_override` — the one-shot path is always a
    /// RAW `$SHELL -c`, never session-backed.
    pub command: Option<String>,
    /// When set, spawn THIS program instead of the resolved `$SHELL` — the
    /// dtach/tmux invocation that wraps the chat's shell in a detachable session.
    /// The env/cwd/sizes are applied to it unchanged. Ignored when `command` is
    /// set (the one-shot Debug Console path stays a raw shell).
    pub program_override: Option<(String, Vec<String>)>,
    /// True when the spawned process is a session CLIENT (dtach/tmux) whose
    /// teardown must DETACH (reap the client only), not signal the process group
    /// — the session, and the shell inside it, must outlive the pane. A raw
    /// interactive shell leaves this false and keeps the process-group teardown.
    pub detach_on_drop: bool,
    /// When set, spawn a local `ssh -tt` client and run the shell/command under
    /// `remote_root` on the target host.
    pub remote: Option<RemotePty>,
}

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("pty session {0} not found")]
    NotFound(u32),
    #[error("pty manager is shutting down")]
    ShuttingDown,
    #[error("pty manager began shutting down after the child was spawned")]
    ShuttingDownAfterSpawn,
    #[error("invalid remote PTY root")]
    InvalidRemoteRoot,
    #[error(transparent)]
    Ssh(#[from] crate::remote::SshError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for PtyError {
    fn from(value: anyhow::Error) -> Self {
        PtyError::Other(value.to_string())
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// The reader thread's join handle. Detach must join it after the client
    /// exits so we both confirm the cloned-master fd is closed (no leaked thread)
    /// and don't return while the reader still holds a master fd open.
    reader_thread: Option<std::thread::JoinHandle<()>>,
    /// The shell's pid. portable-pty puts the slave in its own session
    /// (`setsid`), so on Unix this is also its process-group id — we signal the
    /// whole group on teardown so a foreground job (`flutter run`, `gradle`,
    /// `adb`) and its descendants die with the shell, not just the shell itself.
    /// For a dtach/tmux CLIENT this is the client pid — detach signals exactly it
    /// (SIGHUP, not the group) so the client exits while the session survives.
    #[cfg(unix)]
    shell_pid: Option<u32>,
    /// True when this session is a dtach/tmux CLIENT: dropping the pane must
    /// detach (reap the client, leave the process group alone) so the recoverable
    /// session survives. A raw interactive shell is false → full group teardown.
    detach_on_drop: bool,
    remote_lease: Option<RemoteLeaseHandle>,
}

/// Owns every live PTY session. Lives behind Tauri's managed `State`.
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
    next_id: AtomicU32,
    shutting_down: AtomicBool,
    start_gate: Arc<StartGate>,
    #[cfg(test)]
    after_child_spawn: Mutex<Option<Arc<dyn Fn(Option<u32>) + Send + Sync>>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU32::new(1),
            shutting_down: AtomicBool::new(false),
            start_gate: Arc::new(StartGate::default()),
            #[cfg(test)]
            after_child_spawn: Mutex::new(None),
        }
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a pty and stream its output to `sink`. Without `opts.command` this
    /// is the user's interactive `$SHELL`; with it, a one-shot `$SHELL -c
    /// <command>` that exits when the command does. Returns the session id.
    pub fn spawn<S: PtySink>(&self, opts: SpawnOptions, sink: S) -> Result<u32, PtyError> {
        let _start_permit = self
            .start_gate
            .begin()
            .map_err(|_| PtyError::ShuttingDown)?;
        let rows = if opts.rows == 0 { 24 } else { opts.rows };
        let cols = if opts.cols == 0 { 80 } else { opts.cols };

        // One-shot command mode (Debug Console) is ALWAYS a raw `$SHELL -c` and
        // never session-backed — a `program_override` would be wrong here (it
        // would reattach to a stale session instead of running the command), so
        // the one-shot path takes precedence and ignores any override.
        let one_shot = opts
            .command
            .as_ref()
            .filter(|c| !c.trim().is_empty())
            .cloned();

        let (program, args, remote_lease) = if let Some(remote) = opts.remote.as_ref() {
            let (args, lease) = remote_pty_ssh_args(remote, one_shot.as_deref())?;
            ("ssh".to_string(), args, lease)
        } else {
            let (program, args) = match (&one_shot, opts.program_override.clone()) {
                // Session-backed chat shell: spawn the dtach/tmux client verbatim.
                (None, Some((prog, prog_args))) => (prog, prog_args),
                // Raw shell (interactive, or one-shot `$SHELL -c <command>`).
                _ => {
                    let ShellInvocation { program, mut args } = resolve_shell();
                    if let Some(command) = one_shot.as_ref() {
                        args.push("-c".to_string());
                        args.push(command.clone());
                    }
                    (program, args)
                }
            };
            (program, args, None)
        };
        // A one-shot command can never run detached — it must reap normally.
        let detach_on_drop = opts.detach_on_drop && one_shot.is_none();
        if let Some(lease) = remote_lease.as_ref() {
            lease.prepare()?;
        }

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }
        if let Some(cwd) = local_spawn_cwd(opts.remote.as_ref(), opts.cwd.as_deref()) {
            cmd.cwd(cwd);
        }
        // Base the shell's env on the resolved login-shell environment (so PATH
        // additions from rc files — bun/npm/asdf/mise/cargo — are present), then
        // normalise colour vars and merge any caller extras (PICKFORGE_*).
        // env_clear first so removed keys (NO_COLOR, …) really disappear.
        cmd.env_clear();
        let mut env = normalize_pty_env(user_shell_environment().clone());
        env.extend(opts.extra_env);
        for (key, value) in env {
            cmd.env(key, value);
        }

        let mut child = pair.slave.spawn_command(cmd)?;
        // Crash containment: register the shell/client as an owned tree root
        // (no-op unless the guardian/job is active). A detachable dtach/tmux
        // CLIENT still registers — abrupt app death must take the whole
        // recoverable session down per the #208 ownership decision, and the
        // guardian additionally sweeps this instance's dtach/tmux namespace.
        if let Some(pid) = child.process_id() {
            crate::process::contain_owned_root(pid);
        }
        #[cfg(test)]
        if let Some(hook) = self
            .after_child_spawn
            .lock()
            .expect("pty spawn hook poisoned")
            .clone()
        {
            hook(child.process_id());
        }
        if let Some(lease) = remote_lease.as_ref() {
            if let Err(error) = lease.start_heartbeat() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(PtyError::Io(error));
            }
        }
        drop(pair.slave); // parent must close its slave handle

        #[cfg(unix)]
        let shell_pid = child.process_id();

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let session = Session {
            master: pair.master,
            writer,
            child,
            reader_thread: None,
            #[cfg(unix)]
            shell_pid,
            detach_on_drop,
            remote_lease,
        };

        // Register before starting the reader so a shell that exits immediately
        // can't try to remove its session before it has been inserted. The reader
        // thread handle is attached just below, once the thread is spawned.
        // Re-check the shutdown gate UNDER the registry lock: shutdown() sets the
        // flag before draining under this same lock, so a spawn that raced past
        // the entry check can't insert a session behind the drain.
        {
            let mut sessions = self.sessions.lock().expect("pty registry poisoned");
            if self.shutting_down.load(Ordering::SeqCst) {
                drop(sessions);
                teardown_session(session);
                return Err(PtyError::ShuttingDownAfterSpawn);
            }
            sessions.insert(id, session);
        }

        let sink = Arc::new(sink);
        let sessions = Arc::clone(&self.sessions);
        match std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || read_loop(id, reader, sink, sessions))
        {
            Ok(handle) => {
                // Store the join handle so detach can join the reader after the
                // client exits. The session may already be gone if an instant-exit
                // shell's reader removed it before we got the lock back — fine, the
                // thread is then already finishing on its own.
                if let Some(session) = self
                    .sessions
                    .lock()
                    .expect("pty registry poisoned")
                    .get_mut(&id)
                {
                    session.reader_thread = Some(handle);
                }
            }
            Err(err) => {
                // Roll back the just-registered session so a failed reader spawn
                // can't leak the child + PTY handles.
                let removed = self
                    .sessions
                    .lock()
                    .expect("pty registry poisoned")
                    .remove(&id);
                if let Some(mut session) = removed {
                    if let Some(lease) = session.remote_lease.take() {
                        lease.stop();
                    }
                    let _ = session.child.kill();
                    let _ = session.child.wait();
                }
                return Err(PtyError::from(err));
            }
        }

        Ok(id)
    }

    /// Send bytes (keystrokes / pasted text) to a session's shell.
    pub fn write(&self, id: u32, bytes: &[u8]) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().expect("pty registry poisoned");
        let session = sessions.get_mut(&id).ok_or(PtyError::NotFound(id))?;
        session.writer.write_all(bytes)?;
        session.writer.flush()?;
        Ok(())
    }

    /// Resize a session's pty to `rows`×`cols`.
    pub fn resize(&self, id: u32, rows: u16, cols: u16) -> Result<(), PtyError> {
        let sessions = self.sessions.lock().expect("pty registry poisoned");
        let session = sessions.get(&id).ok_or(PtyError::NotFound(id))?;
        session.master.resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    /// Kill a session's shell and drop it from the registry.
    ///
    /// This is the RAW teardown: it signals the shell's whole process group so a
    /// foreground job (`flutter run`/`gradle`/`adb`) dies with the shell. For a
    /// session-backed pane (dtach/tmux) use [`detach`](Self::detach) instead —
    /// killing the client's group here would also take down the recoverable
    /// session, defeating the whole point.
    pub fn kill(&self, id: u32) -> Result<(), PtyError> {
        // Remove under the lock, then signal + reap outside it so the registry
        // lock is never held across a blocking wait. Once removed, the reader
        // thread's own EOF path can't reap the child, so we must wait here.
        let removed = self
            .sessions
            .lock()
            .expect("pty registry poisoned")
            .remove(&id);
        if let Some(session) = removed {
            teardown_session(session);
        }
        Ok(())
    }

    /// Detach a session-backed pane WITHOUT killing it: drop the PTY handles so
    /// the dtach/tmux client sees EOF and detaches, then REAP that client so it
    /// can't linger as a zombie — but never signal the process group, so the
    /// session (and the agent shell inside it) keeps running for the next attach.
    ///
    /// Falls back to a full [`kill`](Self::kill) for a session that wasn't spawned
    /// detachable (`detach_on_drop == false`), so calling `detach` on a raw shell
    /// still tears it down cleanly rather than leaking it.
    pub fn detach(&self, id: u32) -> Result<(), PtyError> {
        let removed = self
            .sessions
            .lock()
            .expect("pty registry poisoned")
            .remove(&id);
        let Some(session) = removed else {
            return Ok(()); // already gone (e.g. the reader hit EOF first)
        };
        if !session.detach_on_drop {
            // Not a recoverable session — tear it down like kill() would.
            teardown_session(session);
            return Ok(());
        }
        // Detach the dtach/tmux CLIENT so the session (and the agent shell inside
        // it) survives for the next attach.
        //
        // Closing all master fds is what makes the client see its controlling
        // terminal hang up and detach — but the READER THREAD holds a CLONED
        // master fd (`try_clone_reader`), so dropping only `master` + `writer`
        // here leaves that clone open, the client may never see the hangup, and
        // `child.wait()` could block forever (leaking the thread + a stuck
        // client). So we ALSO SIGHUP the client's own pid (never its process
        // group — that would take the session down with it): SIGHUP makes a
        // dtach/tmux client exit (detaching) regardless of the lingering fd, the
        // master read then returns EOF, and the reader thread finishes. We join
        // it afterwards to guarantee the clone is closed and nothing leaks.
        let Session {
            master,
            writer,
            mut child,
            reader_thread,
            #[cfg(unix)]
            shell_pid,
            remote_lease,
            ..
        } = session;
        if let Some(lease) = remote_lease {
            lease.stop();
        }
        drop(writer);
        drop(master);
        #[cfg(unix)]
        signal_client_hangup(shell_pid);
        let _ = child.wait();
        if let Some(t) = reader_thread {
            // The client has exited, so its master read returns EOF and the reader
            // loop ends; joining confirms the cloned fd is closed (no leaked
            // thread / fd) before we return.
            let _ = t.join();
        }
        Ok(())
    }

    /// Idempotently drain and tear down every PTY session. Returns the number
    /// whose reap did not complete before the shared shutdown deadline.
    pub fn shutdown(&self) -> usize {
        self.start_gate.close();
        self.shutting_down.store(true, Ordering::SeqCst);
        self.start_gate.wait();
        let mut drained = {
            let mut sessions = self.sessions.lock().expect("pty registry poisoned");
            sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        let leases = drained
            .iter_mut()
            .filter_map(|session| session.remote_lease.take())
            .collect();
        stop_remote_leases_bounded(leases);
        teardown_sessions(drained, PTY_SHUTDOWN_TIMEOUT)
    }

    /// Number of live sessions (handy for tests / diagnostics).
    pub fn len(&self) -> usize {
        self.sessions.lock().expect("pty registry poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Tear down a drained registry with one shared Unix grace period. Signalling
/// every group before waiting avoids an N×150 ms exit as PTY count grows.
fn teardown_sessions(sessions: Vec<Session>, timeout: std::time::Duration) -> usize {
    #[cfg(unix)]
    {
        let mut pgids = Vec::new();
        for session in &sessions {
            extend_process_group_ids(
                &mut pgids,
                session.shell_pid,
                session.master.process_group_leader(),
            );
        }
        signal_process_groups(&pgids, libc::SIGTERM);
        if !pgids.is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        signal_process_groups(&pgids, libc::SIGKILL);
    }

    let total = sessions.len();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    for mut session in sessions {
        let done_tx = done_tx.clone();
        let _ = std::thread::Builder::new()
            .name("pty-shutdown".to_string())
            .spawn(move || {
                let _ = session.child.kill();
                let _ = session.child.wait();
                if let Some(thread) = session.reader_thread.take() {
                    let _ = thread.join();
                }
                let _ = done_tx.send(());
            });
    }
    drop(done_tx);

    let deadline = std::time::Instant::now() + timeout;
    let mut completed = 0;
    while completed < total {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() || done_rx.recv_timeout(remaining).is_err() {
            break;
        }
        completed += 1;
    }
    total - completed
}

/// Must run outside the registry lock because the reader thread takes it on EOF.
fn teardown_session(mut session: Session) {
    if let Some(lease) = session.remote_lease.take() {
        lease.stop();
    }
    #[cfg(unix)]
    terminate_process_groups(session.shell_pid, session.master.process_group_leader());
    let _ = session.child.kill();
    let _ = session.child.wait();
    if let Some(t) = session.reader_thread.take() {
        let _ = t.join();
    }
}

fn remote_pty_ssh_args(
    remote: &RemotePty,
    command: Option<&str>,
) -> Result<(Vec<String>, Option<RemoteLeaseHandle>), PtyError> {
    let target = SshTarget::new(remote.host.clone())?;
    validate_remote_root(&remote.remote_root)?;
    let payload = match command {
        Some(command) => RemoteLeasePayload::LoginCommand {
            cwd: remote.remote_root.clone(),
            command: command.to_string(),
        },
        None => RemoteLeasePayload::LoginShell {
            cwd: remote.remote_root.clone(),
        },
    };
    let (remote_command, lease) = remote_process_command(
        &target,
        remote.remote_process_leases,
        payload,
        remote_pty_command(&remote.remote_root, command),
    );

    let mut args = ssh_base_args();
    args.push("-o".to_string());
    args.push("EscapeChar=none".to_string());
    args.push("-tt".to_string());
    args.push("--".to_string());
    args.push(target.host);
    args.push(remote_command);
    Ok((args, lease))
}

fn remote_pty_command(remote_root: &str, command: Option<&str>) -> String {
    let quoted_root = shell_quote_argv(&[remote_root]);
    match command {
        Some(command) => format!(
            "cd {quoted_root} && exec \"$SHELL\" -lc {}",
            shell_quote_argv(&[command])
        ),
        None => format!("cd {quoted_root} && exec \"$SHELL\" -l"),
    }
}

fn local_spawn_cwd<'a>(remote: Option<&RemotePty>, cwd: Option<&'a str>) -> Option<&'a str> {
    if remote.is_some() {
        None
    } else {
        cwd.filter(|c| !c.is_empty())
    }
}

fn validate_remote_root(remote_root: &str) -> Result<(), PtyError> {
    if remote_root.is_empty() || !remote_root.starts_with('/') || remote_root.contains('\0') {
        Err(PtyError::InvalidRemoteRoot)
    } else {
        Ok(())
    }
}

fn read_loop<S: PtySink>(
    id: u32,
    mut reader: Box<dyn Read + Send>,
    sink: Arc<S>,
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
) {
    let mut buf = [0u8; 8192];
    let mut reader_failed = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = buf[..n].to_vec();
                // A panicking sink must not skip the reap below.
                let delivered = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    sink.emit(PtyEvent::Output(chunk))
                }))
                .is_ok();
                if !delivered {
                    reader_failed = true;
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                reader_failed = true;
                break;
            }
        }
    }

    // Drop the session and reap the child so PTY/child handles don't leak after
    // the shell exits on its own (the common case). A reader/sink failure is
    // different: stop the exact remote lease and local process immediately.
    let removed = sessions.lock().expect("pty registry poisoned").remove(&id);
    let code = removed.and_then(|mut session| {
        if reader_failed {
            if let Some(lease) = session.remote_lease.take() {
                lease.stop();
            }
            #[cfg(unix)]
            terminate_process_groups(session.shell_pid, session.master.process_group_leader());
            let _ = session.child.kill();
        } else if let Some(lease) = session.remote_lease.take() {
            lease.finish_natural();
        }
        session
            .child
            .wait()
            .ok()
            .map(|status| status.exit_code() as i32)
    });
    let _ = std::panic::catch_unwind(AssertUnwindSafe(|| sink.emit(PtyEvent::Exit(code))));
}

/// SIGHUP the dtach/tmux CLIENT process — and ONLY it (its own pid, never the
/// process group) — so the client exits and detaches while the session (the
/// dtach master / tmux server and the shell inside) keeps running for the next
/// attach. Used on detach as a belt-and-braces hangup: the master fds are also
/// dropped, but the reader thread's cloned fd can keep the client from noticing
/// the hangup on its own, so we make it explicit. ESRCH (already gone) is
/// harmless and ignored.
#[cfg(unix)]
fn signal_client_hangup(client_pid: Option<u32>) {
    if let Some(pid) = client_pid {
        // SAFETY: kill() with a valid pid is well-defined; signalling a single
        // pid (positive arg) never reaches the process group, so the detached
        // session is untouched.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGHUP);
        }
    }
}

/// Signal the shell's process group — and the controlling terminal's current
/// foreground group, in case job control split the active job into its own —
/// with SIGTERM, a short grace, then SIGKILL, so descendants of a foreground
/// command die with the shell. The shell pid doubles as a pgid because
/// portable-pty `setsid`s the slave (session + group leader).
#[cfg(unix)]
fn terminate_process_groups(shell_pid: Option<u32>, foreground_leader: Option<libc::pid_t>) {
    let mut pgids = Vec::new();
    extend_process_group_ids(&mut pgids, shell_pid, foreground_leader);
    signal_process_groups(&pgids, libc::SIGTERM);
    if !pgids.is_empty() {
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    signal_process_groups(&pgids, libc::SIGKILL);
}

#[cfg(unix)]
fn extend_process_group_ids(
    pgids: &mut Vec<libc::pid_t>,
    shell_pid: Option<u32>,
    foreground_leader: Option<libc::pid_t>,
) {
    if let Some(pid) = shell_pid {
        let pid = pid as libc::pid_t;
        if !pgids.contains(&pid) {
            pgids.push(pid);
        }
    }
    if let Some(pgid) = foreground_leader {
        if pgid > 0 && !pgids.contains(&pgid) {
            pgids.push(pgid);
        }
    }
}

#[cfg(unix)]
fn signal_process_groups(pgids: &[libc::pid_t], signal: libc::c_int) {
    for &pgid in pgids {
        // SAFETY: killpg with a positive pgid is well-defined; ESRCH means the
        // exact group already exited and is harmless.
        unsafe {
            libc::killpg(pgid, signal);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote(host: &str, remote_root: &str) -> RemotePty {
        RemotePty {
            host: host.to_string(),
            remote_root: remote_root.to_string(),
            remote_process_leases: false,
        }
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_waits_for_post_spawn_rollback_and_child_death() {
        let manager = Arc::new(PtyManager::new());
        let (spawned_tx, spawned_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release_rx = Arc::new(Mutex::new(release_rx));
        *manager
            .after_child_spawn
            .lock()
            .expect("pty spawn hook poisoned") = Some(Arc::new(move |pid| {
            spawned_tx.send(pid).unwrap();
            release_rx.lock().unwrap().recv().unwrap();
        }));
        let spawning_manager = Arc::clone(&manager);
        let spawn =
            std::thread::spawn(move || spawning_manager.spawn(SpawnOptions::default(), |_| {}));
        let pid = spawned_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
            .unwrap() as i32;
        let shutdown_manager = Arc::clone(&manager);
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let shutdown = std::thread::spawn(move || {
            shutdown_manager.shutdown();
            done_tx.send(()).unwrap();
        });
        assert!(
            done_rx
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_err(),
            "shutdown returned while a post-spawn permit was still active"
        );

        release_tx.send(()).unwrap();
        assert!(matches!(
            spawn.join().unwrap(),
            Err(PtyError::ShuttingDownAfterSpawn)
        ));
        done_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        shutdown.join().unwrap();
        assert!(
            !std::path::Path::new(&format!("/proc/{pid}")).exists(),
            "post-spawn PTY child survived shutdown"
        );
    }

    #[test]
    fn remote_pty_argv_without_command_starts_login_shell_under_root() {
        assert_eq!(
            remote_pty_ssh_args(&remote("mac-mini", "/Users/dev/app"), None).unwrap().0,
            vec![
                "-o",
                "ConnectTimeout=5",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "EscapeChar=none",
                "-tt",
                "--",
                "mac-mini",
                "cd '/Users/dev/app' && exec \"$SHELL\" -l",
            ]
        );
    }

    #[test]
    fn remote_pty_argv_with_command_runs_remote_login_shell_c_under_root() {
        assert_eq!(
            remote_pty_ssh_args(
                &remote("mac-mini", "/Users/dev/app"),
                Some("bun run test:unit")
            )
            .unwrap().0,
            vec![
                "-o",
                "ConnectTimeout=5",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "EscapeChar=none",
                "-tt",
                "--",
                "mac-mini",
                "cd '/Users/dev/app' && exec \"$SHELL\" -lc 'bun run test:unit'",
            ]
        );
    }

    #[test]
    fn remote_pty_argv_quotes_root_and_command_as_data() {
        let (args, lease) = remote_pty_ssh_args(
            &remote("mac-mini", "/Users/dev/it's $root`tick`"),
            Some("printf '%s' \"$SHELL\" \"$HOME\" `uname`"),
        )
        .unwrap();
        assert!(lease.is_none());

        assert_eq!(
            args.last().unwrap(),
            r#"cd '/Users/dev/it'\''s $root`tick`' && exec "$SHELL" -lc 'printf '\''%s'\'' "$SHELL" "$HOME" `uname`'"#
        );
    }

    #[test]
    fn remote_pty_lease_keeps_tt_and_encodes_bootstrap_data() {
        let mut remote = remote("mac-mini", "/Users/dev/secret root");
        remote.remote_process_leases = true;
        let (args, lease) =
            remote_pty_ssh_args(&remote, Some("printf 'hostile' $HOME")).unwrap();

        assert!(args.iter().any(|arg| arg == "-tt"));
        assert!(!args.last().unwrap().contains("/Users/dev/secret root"));
        assert!(!args.last().unwrap().contains("hostile"));
        lease
            .expect("flag-on PTY owns a lease")
            .finish_natural();
    }

    #[test]
    fn remote_pty_ignores_local_cwd() {
        let remote = remote("mac-mini", "/Users/dev/app");
        let cwd = "/does/not/exist";
        assert_eq!(local_spawn_cwd(Some(&remote), Some(cwd)), None);
        assert_eq!(local_spawn_cwd(None, Some(cwd)), Some(cwd));
    }

    #[test]
    fn remote_pty_rejects_invalid_hosts() {
        for host in ["", "-oProxyCommand=sh"] {
            assert!(
                matches!(
                    remote_pty_ssh_args(&remote(host, "/Users/dev/app"), None),
                    Err(PtyError::Ssh(crate::remote::SshError::InvalidHost))
                ),
                "{host:?}"
            );
        }
    }

    #[test]
    fn remote_pty_rejects_invalid_roots() {
        for root in ["", "relative/path", "\0", "/Users/dev/app\0bad"] {
            assert!(
                matches!(
                    remote_pty_ssh_args(&remote("mac-mini", root), None),
                    Err(PtyError::InvalidRemoteRoot)
                ),
                "{root:?}"
            );
        }
    }
}
