//! Ember talk-back: local OS TTS playback.
//!
//! Mirrors two precedents already in this codebase rather than inventing a
//! new audio subsystem: `stt.rs`'s PATH-resolved-external-binary idiom (spawn
//! a preinstalled CLI, argv-style, never a shell) and `session.rs`'s
//! session-handle registry (so `voice_speak`/`voice_speak_cancel` behave like
//! `voice_start`/`voice_stop`).
//!
//! `SpeechBackend`/`RunningSpeech` are the architecture seam for #199 (the
//! Realtime BYO-key backend): a future streaming implementation swaps in
//! here — the Tauri commands, the session registry, and every bit of
//! gating/spoken-form logic above this module stay untouched.

use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;

use super::VoiceError;

/// Max spoken text length (in `char`s); longer text is truncated before
/// reaching the TTS binary. Bounds both nuisance-length utterances and the
/// worst-case runtime of a single child process.
pub const MAX_SPEECH_CHARS: usize = 400;

/// Hard ceiling on how long a single utterance may run. A hung or
/// misbehaving TTS binary must never wedge the speak slot open — past this,
/// `wait` kills the child itself, the same way a barge-in cancel would.
const SPEECH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeakEventKind {
    Started,
    Finished,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakEvent {
    pub kind: SpeakEventKind,
    pub session_id: String,
    pub message: Option<String>,
}

impl SpeakEvent {
    pub fn started(session_id: &str) -> Self {
        Self {
            kind: SpeakEventKind::Started,
            session_id: session_id.to_string(),
            message: None,
        }
    }

    pub fn finished(session_id: &str) -> Self {
        Self {
            kind: SpeakEventKind::Finished,
            session_id: session_id.to_string(),
            message: None,
        }
    }

    pub fn error(session_id: &str, message: String) -> Self {
        Self {
            kind: SpeakEventKind::Error,
            session_id: session_id.to_string(),
            message: Some(message),
        }
    }
}

/// Mirrors `VoiceSink`, but for `SpeakEvent` — kept as a sibling trait
/// (rather than widening `VoiceSink` to a generic) so dictation's
/// partial/final/error/level events and speak's started/finished/error
/// events stay two unrelated channels, matching how the frontend already
/// treats dictation and talk-back as separate concerns.
pub trait SpeakSink: Send + Sync + 'static {
    fn emit(&self, event: SpeakEvent);
}

impl<F> SpeakSink for F
where
    F: Fn(SpeakEvent) + Send + Sync + 'static,
{
    fn emit(&self, event: SpeakEvent) {
        self(event)
    }
}

/// The audio-backend seam: today `OsTtsBackend` spawns a local OS voice.
/// #199's Realtime backend implements the same trait (streaming audio over
/// a network session instead of a child process) without the loop, the
/// safe-action gate, or the spoken-form template above it changing at all.
pub trait SpeechBackend: Send + Sync + 'static {
    /// Verify the backend can run at all (platform + PATH check) before
    /// spawning — mirrors `VoiceTranscriber::prepare`.
    fn prepare(&self) -> Result<(), VoiceError>;

    /// Start speaking `text`, returning a handle to the in-flight utterance.
    /// Must return once the utterance has *started*, not once it finishes.
    fn start_speaking(&self, text: &str) -> Result<Arc<dyn RunningSpeech>, VoiceError>;
}

pub trait RunningSpeech: Send + Sync + 'static {
    /// Block until the utterance finishes, errors, is killed, or times out.
    fn wait(&self) -> Result<(), VoiceError>;
    /// Hard-cancel the utterance (barge-in). Idempotent: a second call is a
    /// no-op, never a second signal or an error.
    fn kill(&self);
}

/// Local OS TTS: `say` on macOS, `spd-say` then `espeak-ng` on Linux — the
/// first found on PATH, resolved against the user's real login-shell
/// environment exactly like `stt.rs`'s whisper-cli lookup.
#[derive(Debug, Clone, Default)]
pub struct OsTtsBackend {
    /// Test-only PATH override, mirrors `PwRecordBackend::with_env`.
    env: Option<HashMap<String, String>>,
}

impl OsTtsBackend {
    #[cfg(test)]
    pub fn with_env(env: HashMap<String, String>) -> Self {
        Self { env: Some(env) }
    }

    fn env(&self) -> HashMap<String, String> {
        self.env.clone().unwrap_or_else(|| {
            crate::process::user_shell_environment()
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
    }

    fn candidates() -> &'static [&'static str] {
        if cfg!(target_os = "macos") {
            &["say"]
        } else if cfg!(target_os = "linux") {
            &["spd-say", "espeak-ng"]
        } else {
            &[]
        }
    }

    fn resolve_program(&self, env: &HashMap<String, String>) -> Option<&'static str> {
        Self::candidates()
            .iter()
            .copied()
            .find(|candidate| crate::process::is_binary_on_path(candidate, env))
    }
}

impl SpeechBackend for OsTtsBackend {
    fn prepare(&self) -> Result<(), VoiceError> {
        if Self::candidates().is_empty() {
            return Err(VoiceError::UnsupportedPlatform);
        }
        if self.resolve_program(&self.env()).is_none() {
            return Err(VoiceError::MissingTtsBinary);
        }
        Ok(())
    }

    fn start_speaking(&self, text: &str) -> Result<Arc<dyn RunningSpeech>, VoiceError> {
        let env = self.env();
        let program = self
            .resolve_program(&env)
            .ok_or(VoiceError::MissingTtsBinary)?;

        // Argv-style, never a shell: `text` is passed as one argument, never
        // interpolated into a command string.
        let mut command = Command::new(program);
        command
            .arg(text)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.env_clear();
        for (key, value) in env {
            command.env(key, value);
        }

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                VoiceError::MissingTtsBinary
            } else {
                VoiceError::Io(error)
            }
        })?;
        crate::process::contain_owned_root(child.id());
        Ok(Arc::new(OsTtsJob {
            pid: child.id(),
            child: Mutex::new(Some(child)),
            killed: AtomicBool::new(false),
            timed_out: AtomicBool::new(false),
        }))
    }
}

struct OsTtsJob {
    pid: u32,
    child: Mutex<Option<Child>>,
    /// Guards signal-sending idempotency: only the first `kill()` call
    /// issues a killpg.
    killed: AtomicBool,
    /// Separate from `killed` so `wait()` can report a timeout distinctly
    /// from a barge-in cancel, even though both end up calling `kill()`.
    timed_out: AtomicBool,
}

impl RunningSpeech for OsTtsJob {
    fn wait(&self) -> Result<(), VoiceError> {
        let deadline = Instant::now() + SPEECH_TIMEOUT;
        loop {
            let status = {
                let mut guard = self.child.lock().expect("tts child poisoned");
                match guard.as_mut() {
                    None => return Ok(()), // already reaped by a prior wait()
                    Some(child) => child.try_wait().map_err(VoiceError::Io)?,
                }
            };
            if let Some(status) = status {
                self.child.lock().expect("tts child poisoned").take();
                if self.timed_out.load(Ordering::SeqCst) {
                    return Err(VoiceError::Timeout("speech".to_string()));
                }
                if self.killed.load(Ordering::SeqCst) {
                    return Err(VoiceError::Interrupted);
                }
                return if status.success() {
                    Ok(())
                } else {
                    Err(VoiceError::Pipeline(format!(
                        "tts exited with {:?}",
                        status.code()
                    )))
                };
            }
            if Instant::now() >= deadline && !self.timed_out.swap(true, Ordering::SeqCst) {
                self.kill();
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn kill(&self) {
        if self.killed.swap(true, Ordering::SeqCst) {
            return;
        }
        kill_process_group(self.pid);
    }
}

/// Same idiom as `stt.rs::kill_process_group`: SIGTERM the process group,
/// then SIGKILL after a brief grace window.
fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    {
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGTERM);
        }
        thread::sleep(Duration::from_millis(300));
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
}

fn bound_text(text: &str) -> Result<String, VoiceError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(VoiceError::EmptySpeechText);
    }
    if trimmed.chars().count() <= MAX_SPEECH_CHARS {
        return Ok(trimmed.to_string());
    }
    let truncated: String = trimmed.chars().take(MAX_SPEECH_CHARS).collect();
    Ok(format!("{truncated}\u{2026}"))
}

fn random_speech_session_id() -> String {
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut id = String::from("speak-");
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut id, "{byte:02x}");
    }
    id
}

/// One utterance in flight at a time is the product shape (push-to-talk,
/// barge-in supersedes) but the registry is keyed by session id — not a
/// single `Option` slot — so `voice_speak`/`voice_speak_cancel` can mirror
/// `voice_start`/`voice_cancel`'s session-id shape exactly.
pub struct SpeechSessionManager<B: SpeechBackend = OsTtsBackend> {
    backend: Arc<B>,
    sessions: Arc<Mutex<HashMap<String, Arc<dyn RunningSpeech>>>>,
}

impl SpeechSessionManager<OsTtsBackend> {
    pub fn new() -> Self {
        Self::with_backend(OsTtsBackend::default())
    }
}

impl Default for SpeechSessionManager<OsTtsBackend> {
    fn default() -> Self {
        Self::new()
    }
}

impl<B: SpeechBackend> SpeechSessionManager<B> {
    pub fn with_backend(backend: B) -> Self {
        Self {
            backend: Arc::new(backend),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Speak `text`, returning a session id immediately once the utterance
    /// has started (mirrors `VoiceSessionManager::start`) — the sink emits
    /// `started` synchronously here and `finished`/`error` later, off a
    /// background thread, once the utterance settles.
    pub fn speak<S>(&self, text: &str, sink: S) -> Result<String, VoiceError>
    where
        S: SpeakSink,
    {
        self.backend.prepare()?;
        let bounded = bound_text(text)?;
        let session_id = self.next_session_id();
        let handle = self.backend.start_speaking(&bounded)?;
        self.sessions
            .lock()
            .expect("speak registry poisoned")
            .insert(session_id.clone(), Arc::clone(&handle));

        let sink = Arc::new(sink);
        sink.emit(SpeakEvent::started(&session_id));

        let sessions = Arc::clone(&self.sessions);
        let waiter_id = session_id.clone();
        thread::Builder::new()
            .name(format!("speak-session-{waiter_id}"))
            .spawn(move || {
                let outcome = handle.wait();
                sessions
                    .lock()
                    .expect("speak registry poisoned")
                    .remove(&waiter_id);
                match outcome {
                    // A cancelled (barge-in) utterance settles quietly —
                    // barge-in is expected, not exceptional, so it reports
                    // as a normal finish rather than an error.
                    Ok(()) | Err(VoiceError::Interrupted) => {
                        sink.emit(SpeakEvent::finished(&waiter_id));
                    }
                    Err(error) => sink.emit(SpeakEvent::error(&waiter_id, error.to_string())),
                }
            })
            .map_err(VoiceError::Io)?;

        Ok(session_id)
    }

    /// Hard-kill an in-flight utterance (barge-in). Idempotent: cancelling
    /// an already-finished or unknown session is a no-op, not an error —
    /// the frontend's epoch guard may race a cancel against natural
    /// completion.
    pub fn cancel(&self, session_id: &str) -> Result<(), VoiceError> {
        if let Some(handle) = self
            .sessions
            .lock()
            .expect("speak registry poisoned")
            .get(session_id)
            .cloned()
        {
            handle.kill();
        }
        Ok(())
    }

    fn next_session_id(&self) -> String {
        loop {
            let id = random_speech_session_id();
            if !self
                .sessions
                .lock()
                .expect("speak registry poisoned")
                .contains_key(&id)
            {
                return id;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;
    use std::time::SystemTime;

    fn fake_bin_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "pf-speak-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_script(dir: &std::path::Path, name: &str, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let script = dir.join(name);
        std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn env_with_path(dir: &std::path::Path) -> HashMap<String, String> {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), dir.to_string_lossy().into_owned());
        env
    }

    fn backend_name() -> &'static str {
        if cfg!(target_os = "macos") {
            "say"
        } else {
            "spd-say"
        }
    }

    fn drain(rx: &mpsc::Receiver<SpeakEvent>, timeout: Duration) -> Vec<SpeakEvent> {
        let mut events = Vec::new();
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining) {
                Ok(event) => {
                    let is_terminal =
                        matches!(event.kind, SpeakEventKind::Finished | SpeakEventKind::Error);
                    events.push(event);
                    if is_terminal {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        events
    }

    #[test]
    fn bound_text_rejects_empty_and_truncates_long_input() {
        assert!(matches!(
            bound_text("   "),
            Err(VoiceError::EmptySpeechText)
        ));
        assert_eq!(bound_text(" hi ").unwrap(), "hi");

        let long = "a".repeat(MAX_SPEECH_CHARS + 50);
        let bounded = bound_text(&long).unwrap();
        assert_eq!(bounded.chars().count(), MAX_SPEECH_CHARS + 1); // + the ellipsis char
        assert!(bounded.ends_with('\u{2026}'));
    }

    #[cfg(unix)]
    #[test]
    fn speaks_via_fake_binary_and_emits_started_then_finished() {
        let dir = fake_bin_dir("ok");
        write_script(&dir, backend_name(), "exit 0");
        let backend = OsTtsBackend::with_env(env_with_path(&dir));
        let manager = SpeechSessionManager::with_backend(backend);

        let (tx, rx) = mpsc::channel();
        let session_id = manager
            .speak("hello from the fake binary", move |event: SpeakEvent| {
                let _ = tx.send(event);
            })
            .expect("speak should start");

        let events = drain(&rx, Duration::from_secs(5));
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, SpeakEventKind::Started);
        assert_eq!(events[0].session_id, session_id);
        assert_eq!(events[1].kind, SpeakEventKind::Finished);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_failing_binary_emits_a_speak_error() {
        let dir = fake_bin_dir("fail");
        write_script(&dir, backend_name(), "exit 3");
        let backend = OsTtsBackend::with_env(env_with_path(&dir));
        let manager = SpeechSessionManager::with_backend(backend);

        let (tx, rx) = mpsc::channel();
        manager
            .speak("this will fail", move |event: SpeakEvent| {
                let _ = tx.send(event);
            })
            .expect("speak should start even though the binary will exit non-zero");

        let events = drain(&rx, Duration::from_secs(5));
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].kind, SpeakEventKind::Error);
        assert!(events[1].message.as_deref().unwrap_or_default().contains("tts exited"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn cancel_barge_in_kills_a_long_running_utterance_and_settles_as_finished() {
        let dir = fake_bin_dir("slow");
        write_script(&dir, backend_name(), "sleep 30");
        let backend = OsTtsBackend::with_env(env_with_path(&dir));
        let manager = SpeechSessionManager::with_backend(backend);

        let (tx, rx) = mpsc::channel();
        let session_id = manager
            .speak("a long reply", move |event: SpeakEvent| {
                let _ = tx.send(event);
            })
            .expect("speak should start");

        // Wait for `started` before cancelling, then barge in.
        let started = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(started.kind, SpeakEventKind::Started);

        manager.cancel(&session_id).expect("cancel should succeed");
        let finished = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(finished.kind, SpeakEventKind::Finished);

        // Idempotent: cancelling again (already finished/unknown) is a no-op,
        // not an error.
        manager.cancel(&session_id).expect("second cancel is a no-op");
        manager
            .cancel("session-that-never-existed")
            .expect("cancelling an unknown session is a no-op");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn missing_binary_fails_to_start_speaking() {
        let dir = fake_bin_dir("missing");
        std::fs::create_dir_all(&dir).unwrap();
        let backend = OsTtsBackend::with_env(env_with_path(&dir));
        let manager = SpeechSessionManager::with_backend(backend);

        let result = manager.speak("hello", |_event: SpeakEvent| {});
        assert!(matches!(result, Err(VoiceError::MissingTtsBinary)));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_text_never_reaches_the_backend() {
        let dir = fake_bin_dir("unused");
        std::fs::create_dir_all(&dir).unwrap();
        write_script(&dir, backend_name(), "exit 0");
        let backend = OsTtsBackend::with_env(env_with_path(&dir));
        let manager = SpeechSessionManager::with_backend(backend);

        let result = manager.speak("   ", |_event: SpeakEvent| {});
        assert!(matches!(result, Err(VoiceError::EmptySpeechText)));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
