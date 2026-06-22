//! PTY session registry — spawn/read/write/resize/kill on `portable-pty`.
//!
//! Mirrors the Dart `PtyProcess` + `PtyProcessFactory` boundary. The reader runs
//! on a dedicated OS thread (portable-pty's master reader is a blocking `Read`),
//! pushing each chunk to a [`PtySink`]. The UI layer adapts that sink to its own
//! transport (a Tauri `Channel`, today).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use super::env::normalize_pty_env;
use super::shell::{resolve_shell, ShellInvocation};
use crate::process::user_shell_environment;

/// Events emitted by a running PTY session.
#[derive(Debug, Clone)]
pub enum PtyEvent {
    /// A chunk of raw bytes read from the pty master.
    Output(Vec<u8>),
    /// The shell exited (EOF on the master). `code` is best-effort.
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

/// Options for spawning a shell. `rows`/`cols` of 0 default to 24×80.
#[derive(Debug, Clone, Default)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub rows: u16,
    pub cols: u16,
    /// Extra environment merged on top of the normalised login-shell env —
    /// the `PICKFORGE_*` vars (and an IPC endpoint) go here.
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
}

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("pty session {0} not found")]
    NotFound(u32),
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
    /// The shell's pid. portable-pty puts the slave in its own session
    /// (`setsid`), so on Unix this is also its process-group id — we signal the
    /// whole group on teardown so a foreground job (`flutter run`, `gradle`,
    /// `adb`) and its descendants die with the shell, not just the shell itself.
    #[cfg(unix)]
    shell_pid: Option<u32>,
    /// True when this session is a dtach/tmux CLIENT: dropping the pane must
    /// detach (reap the client, leave the process group alone) so the recoverable
    /// session survives. A raw interactive shell is false → full group teardown.
    detach_on_drop: bool,
}

/// Owns every live PTY session. Lives behind Tauri's managed `State`.
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
    next_id: AtomicU32,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU32::new(1),
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
        let rows = if opts.rows == 0 { 24 } else { opts.rows };
        let cols = if opts.cols == 0 { 80 } else { opts.cols };

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // One-shot command mode (Debug Console) is ALWAYS a raw `$SHELL -c` and
        // never session-backed — a `program_override` would be wrong here (it
        // would reattach to a stale session instead of running the command), so
        // the one-shot path takes precedence and ignores any override.
        let one_shot = opts
            .command
            .as_ref()
            .filter(|c| !c.trim().is_empty())
            .cloned();

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
        // A one-shot command can never run detached — it must reap normally.
        let detach_on_drop = opts.detach_on_drop && one_shot.is_none();

        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }
        if let Some(cwd) = opts.cwd.filter(|c| !c.is_empty()) {
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

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave); // parent must close its slave handle

        #[cfg(unix)]
        let shell_pid = child.process_id();

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        // Register before starting the reader so a shell that exits immediately
        // can't try to remove its session before it has been inserted.
        self.sessions
            .lock()
            .expect("pty registry poisoned")
            .insert(
                id,
                Session {
                    master: pair.master,
                    writer,
                    child,
                    #[cfg(unix)]
                    shell_pid,
                    detach_on_drop,
                },
            );

        let sink = Arc::new(sink);
        let sessions = Arc::clone(&self.sessions);
        if let Err(err) = std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || read_loop(id, reader, sink, sessions))
        {
            // Roll back the just-registered session so a failed reader spawn
            // can't leak the child + PTY handles.
            let removed = self.sessions.lock().expect("pty registry poisoned").remove(&id);
            if let Some(mut session) = removed {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
            return Err(PtyError::from(err));
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
        let removed = self.sessions.lock().expect("pty registry poisoned").remove(&id);
        if let Some(mut session) = removed {
            // On Unix, take down the shell's whole process group (and the
            // current foreground job's group) so a `flutter run`/`gradle`/`adb`
            // child can't outlive the shell. Then reap the shell itself.
            #[cfg(unix)]
            terminate_process_groups(session.shell_pid, session.master.process_group_leader());
            let _ = session.child.kill();
            let _ = session.child.wait();
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
        let removed = self.sessions.lock().expect("pty registry poisoned").remove(&id);
        let Some(mut session) = removed else {
            return Ok(()); // already gone (e.g. the reader hit EOF first)
        };
        if !session.detach_on_drop {
            // Not a recoverable session — tear it down like kill() would.
            #[cfg(unix)]
            terminate_process_groups(session.shell_pid, session.master.process_group_leader());
            let _ = session.child.kill();
            let _ = session.child.wait();
            return Ok(());
        }
        // Drop the writer + master so the slave/client sees EOF and the dtach/
        // tmux client detaches on its own. Dropping master also stops the reader
        // thread (its read returns 0). Then reap the now-exiting client so no
        // zombie is left; the master/session it detached from lives on. Never
        // signal the process group — that would take the session down with it.
        let Session {
            master,
            writer,
            mut child,
            ..
        } = session;
        drop(writer);
        drop(master);
        let _ = child.wait();
        Ok(())
    }

    /// Number of live sessions (handy for tests / diagnostics).
    pub fn len(&self) -> usize {
        self.sessions.lock().expect("pty registry poisoned").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn read_loop<S: PtySink>(
    id: u32,
    mut reader: Box<dyn Read + Send>,
    sink: Arc<S>,
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = buf[..n].to_vec();
                // A panicking sink must not skip the reap below.
                let delivered =
                    std::panic::catch_unwind(AssertUnwindSafe(|| sink.emit(PtyEvent::Output(chunk))))
                        .is_ok();
                if !delivered {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }

    // Drop the session and reap the child so PTY/child handles don't leak after
    // the shell exits on its own (the common case).
    let removed = sessions.lock().expect("pty registry poisoned").remove(&id);
    let code = removed
        .and_then(|mut session| session.child.wait().ok())
        .map(|status| status.exit_code() as i32);
    let _ = std::panic::catch_unwind(AssertUnwindSafe(|| sink.emit(PtyEvent::Exit(code))));
}

/// Signal the shell's process group — and the controlling terminal's current
/// foreground group, in case job control split the active job into its own —
/// with SIGTERM, a short grace, then SIGKILL, so descendants of a foreground
/// command die with the shell. The shell pid doubles as a pgid because
/// portable-pty `setsid`s the slave (session + group leader).
#[cfg(unix)]
fn terminate_process_groups(shell_pid: Option<u32>, foreground_leader: Option<libc::pid_t>) {
    let mut pgids: Vec<libc::pid_t> = Vec::new();
    if let Some(pid) = shell_pid {
        pgids.push(pid as libc::pid_t);
    }
    if let Some(pgid) = foreground_leader {
        if pgid > 0 && !pgids.contains(&pgid) {
            pgids.push(pgid);
        }
    }
    if pgids.is_empty() {
        return;
    }

    for pgid in &pgids {
        // SAFETY: killpg with a valid pgid is well-defined; ESRCH (already gone)
        // is harmless and ignored.
        unsafe {
            libc::killpg(*pgid, libc::SIGTERM);
        }
    }
    // Brief grace for a TERM-aware job to clean up before the unconditional kill.
    std::thread::sleep(std::time::Duration::from_millis(150));
    for pgid in &pgids {
        // SAFETY: as above; SIGKILL is unconditionally fatal.
        unsafe {
            libc::killpg(*pgid, libc::SIGKILL);
        }
    }
}
