//! PTY session registry — spawn/read/write/resize/kill on `portable-pty`.
//!
//! Mirrors the Dart `PtyProcess` + `PtyProcessFactory` boundary. The reader runs
//! on a dedicated OS thread (portable-pty's master reader is a blocking `Read`),
//! pushing each chunk to a [`PtySink`]. The UI layer adapts that sink to its own
//! transport (a Tauri `Channel`, today).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use super::env::normalize_pty_env;
use super::shell::{resolve_shell, ShellInvocation};

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
}

/// Owns every live PTY session. Lives behind Tauri's managed `State`.
pub struct PtyManager {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn `$SHELL` in a fresh pty; stream output to `sink`. Returns the id.
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

        let ShellInvocation { program, args } = resolve_shell();
        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }
        if let Some(cwd) = opts.cwd.filter(|c| !c.is_empty()) {
            cmd.cwd(cwd);
        }
        // env_clear so removed keys (NO_COLOR, …) really disappear.
        cmd.env_clear();
        for (key, value) in normalize_pty_env(std::env::vars().collect()) {
            cmd.env(key, value);
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave); // parent must close its slave handle

        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let sink = Arc::new(sink);
        std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || read_loop(reader, sink))?;

        self.sessions
            .lock()
            .expect("pty registry poisoned")
            .insert(
                id,
                Session {
                    master: pair.master,
                    writer,
                    child,
                },
            );
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
    pub fn kill(&self, id: u32) -> Result<(), PtyError> {
        let mut sessions = self.sessions.lock().expect("pty registry poisoned");
        if let Some(mut session) = sessions.remove(&id) {
            let _ = session.child.kill();
        }
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

fn read_loop<S: PtySink>(mut reader: Box<dyn Read + Send>, sink: Arc<S>) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => sink.emit(PtyEvent::Output(buf[..n].to_vec())),
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    sink.emit(PtyEvent::Exit(None));
}
