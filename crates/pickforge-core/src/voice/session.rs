use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use rand::RngCore;

use super::recorder::{ActiveRecording, PwRecordBackend, RecorderBackend};
use super::segments::{
    read_wav_file, rms_level, write_segment_wav, SegmentConfig, Segmenter, WavData,
};
use super::stt::{
    PreparedTranscription, RunningTranscription, VoiceTranscriber, WhisperCliTranscriber,
};
use super::{
    create_private_dir_all, keep_audio_from_env, VoiceError, VoiceEvent, VoiceSink,
    DEFAULT_LANGUAGE,
};
use crate::process::StartGate;

const STALE_SESSION_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceStartRequest {
    pub language: Option<String>,
    pub model_path_override: Option<PathBuf>,
}

impl VoiceStartRequest {
    pub fn new(language: Option<String>, model_path_override: Option<PathBuf>) -> Self {
        Self {
            language,
            model_path_override,
        }
    }

    fn language_or_default(&self) -> String {
        self.language
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_LANGUAGE)
            .to_string()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceSessionPhase {
    Idle,
    Recording,
    Finalizing,
    Done,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct VoiceRuntimeConfig {
    pub poll_interval: Duration,
    pub keep_audio: bool,
    pub segment: SegmentConfig,
}

impl VoiceRuntimeConfig {
    pub fn from_env() -> Self {
        Self {
            poll_interval: DEFAULT_POLL_INTERVAL,
            keep_audio: keep_audio_from_env(),
            segment: SegmentConfig::default(),
        }
    }
}

impl Default for VoiceRuntimeConfig {
    fn default() -> Self {
        Self::from_env()
    }
}

pub struct VoiceSessionManager<R = PwRecordBackend, T = WhisperCliTranscriber> {
    home: Option<PathBuf>,
    home_error: Option<String>,
    recorder: Arc<R>,
    transcriber: Arc<T>,
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
    provisional: Arc<Mutex<HashMap<String, SessionHandle>>>,
    shutting_down: AtomicBool,
    start_gate: Arc<StartGate>,
    config: VoiceRuntimeConfig,
}

impl VoiceSessionManager<PwRecordBackend, WhisperCliTranscriber> {
    pub fn new() -> Self {
        let (home, home_error) = match crate::storage::pickforge_home(None) {
            Ok(home) => (Some(PathBuf::from(home)), None),
            Err(error) => (None, Some(error.to_string())),
        };
        let manager = Self {
            home,
            home_error,
            recorder: Arc::new(PwRecordBackend::default()),
            transcriber: Arc::new(WhisperCliTranscriber),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            provisional: Arc::new(Mutex::new(HashMap::new())),
            shutting_down: AtomicBool::new(false),
            start_gate: Arc::new(StartGate::default()),
            config: VoiceRuntimeConfig::from_env(),
        };
        let _ = manager.sweep_stale_sessions();
        manager
    }
}

impl Default for VoiceSessionManager<PwRecordBackend, WhisperCliTranscriber> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R, T> VoiceSessionManager<R, T>
where
    R: RecorderBackend,
    T: VoiceTranscriber,
{
    pub fn with_backends(home: PathBuf, recorder: R, transcriber: T) -> Self {
        Self::with_config(home, recorder, transcriber, VoiceRuntimeConfig::from_env())
    }

    pub fn with_config(
        home: PathBuf,
        recorder: R,
        transcriber: T,
        config: VoiceRuntimeConfig,
    ) -> Self {
        let manager = Self {
            home: Some(home),
            home_error: None,
            recorder: Arc::new(recorder),
            transcriber: Arc::new(transcriber),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            provisional: Arc::new(Mutex::new(HashMap::new())),
            shutting_down: AtomicBool::new(false),
            start_gate: Arc::new(StartGate::default()),
            config,
        };
        let _ = manager.sweep_stale_sessions();
        manager
    }

    pub fn start<S>(&self, request: VoiceStartRequest, sink: S) -> Result<String, VoiceError>
    where
        S: VoiceSink,
    {
        let _start_permit = self
            .start_gate
            .begin()
            .map_err(|_| VoiceError::ShuttingDown)?;
        #[cfg(not(target_os = "linux"))]
        {
            let _ = request;
            let _ = sink;
            return Err(VoiceError::UnsupportedPlatform);
        }

        #[cfg(target_os = "linux")]
        {
            let home = self.home_dir()?;
            let language = request.language_or_default();
            let PreparedTranscription { model_path } = self
                .transcriber
                .prepare(request.model_path_override.as_deref())?;
            let session_id = self.next_session_id();
            let session_dir = voice_root(&home).join(&session_id);
            let capture_path = session_dir.join("capture.wav");
            create_private_dir_all(&session_dir)?;

            let recording = match self.recorder.start(&capture_path, &self.shutting_down) {
                Ok(recording) => recording,
                Err(error) => {
                    let _ = std::fs::remove_dir_all(&session_dir);
                    return Err(error);
                }
            };

            let state = Arc::new(Mutex::new(VoiceSessionPhase::Idle));
            let completion = Arc::new(Completion::default());
            let (control_tx, control_rx) = std::sync::mpsc::channel();
            let join = Arc::new(Mutex::new(None));
            let active_transcription = Arc::new(Mutex::new(None));
            let handle = SessionHandle {
                control_tx,
                completion: Arc::clone(&completion),
                state: Arc::clone(&state),
                join: Arc::clone(&join),
                active_transcription: Arc::clone(&active_transcription),
            };
            let runner = SessionRunner {
                session_id: session_id.clone(),
                session_dir: session_dir.clone(),
                capture_path,
                language,
                model_path,
                config: self.config.clone(),
                transcriber: Arc::clone(&self.transcriber),
                sink: Arc::new(sink),
                control_rx,
                state,
                completion,
                active_transcription,
            };

            let thread = match thread::Builder::new()
                .name(format!("voice-session-{session_id}"))
                .spawn(move || runner.run(recording))
            {
                Ok(thread) => thread,
                Err(error) => {
                    let _ = std::fs::remove_dir_all(&session_dir);
                    return Err(VoiceError::Io(error));
                }
            };
            *join.lock().expect("voice join poisoned") = Some(thread);
            self.provisional
                .lock()
                .expect("voice provisional registry poisoned")
                .insert(session_id.clone(), handle.clone());
            let mut sessions = self.sessions.lock().expect("voice registry poisoned");
            if self.shutting_down.load(Ordering::SeqCst) {
                drop(sessions);
                if let Some(handle) = self
                    .provisional
                    .lock()
                    .expect("voice provisional registry poisoned")
                    .remove(&session_id)
                {
                    shutdown_handles(vec![handle], Duration::from_secs(5));
                }
                return Err(VoiceError::ShuttingDown);
            }
            sessions.insert(session_id.clone(), handle);
            self.provisional
                .lock()
                .expect("voice provisional registry poisoned")
                .remove(&session_id);
            Ok(session_id)
        }
    }

    pub fn stop(&self, session_id: &str, timeout: Duration) -> Result<String, VoiceError> {
        let handle = self
            .sessions
            .lock()
            .expect("voice registry poisoned")
            .get(session_id)
            .cloned()
            .ok_or_else(|| VoiceError::SessionNotFound(session_id.to_string()))?;
        let _ = handle.control_tx.send(Control::Stop);
        let completion = match handle.completion.wait(timeout) {
            Some(completion) => completion,
            None => {
                let _ = handle.control_tx.send(Control::Cancel);
                kill_active_transcription(&handle);
                let _ = handle.completion.wait(Duration::from_secs(2));
                self.sessions
                    .lock()
                    .expect("voice registry poisoned")
                    .remove(session_id);
                join_runner(&handle);
                return Err(VoiceError::Timeout(session_id.to_string()));
            }
        };
        self.sessions
            .lock()
            .expect("voice registry poisoned")
            .remove(session_id);
        join_runner(&handle);
        completion.into_stop_result()
    }

    pub fn cancel(&self, session_id: &str) -> Result<(), VoiceError> {
        let handle = self
            .sessions
            .lock()
            .expect("voice registry poisoned")
            .get(session_id)
            .cloned()
            .ok_or_else(|| VoiceError::SessionNotFound(session_id.to_string()))?;
        let _ = handle.control_tx.send(Control::Cancel);
        kill_active_transcription(&handle);
        let completion = handle
            .completion
            .wait(Duration::from_secs(5))
            .ok_or_else(|| VoiceError::Timeout(session_id.to_string()))?;
        self.sessions
            .lock()
            .expect("voice registry poisoned")
            .remove(session_id);
        join_runner(&handle);
        completion.into_cancel_result()
    }

    pub fn phase(&self, session_id: &str) -> Option<VoiceSessionPhase> {
        self.sessions
            .lock()
            .expect("voice registry poisoned")
            .get(session_id)
            .map(|handle| *handle.state.lock().expect("voice state poisoned"))
    }

    pub fn active_session_count(&self) -> usize {
        self.sessions.lock().expect("voice registry poisoned").len()
    }

    pub fn sweep_stale_sessions(&self) -> Result<usize, VoiceError> {
        let home = self.home_dir()?;
        sweep_stale_voice_dirs(&home, STALE_SESSION_AGE, SystemTime::now()).map_err(VoiceError::Io)
    }

    /// Cancel every owned voice session under one shared deadline. Returns the
    /// number that did not acknowledge cancellation before the deadline.
    pub fn shutdown(&self) -> usize {
        self.start_gate.close();
        self.shutting_down.store(true, Ordering::SeqCst);
        let (_, incomplete_sessions) =
            shutdown_session_registries(&self.sessions, &self.provisional, Duration::from_secs(5));
        self.start_gate.wait();
        incomplete_sessions
    }

    fn home_dir(&self) -> Result<PathBuf, VoiceError> {
        self.home.clone().ok_or_else(|| {
            VoiceError::Pipeline(
                self.home_error
                    .clone()
                    .unwrap_or_else(|| "cannot resolve PickForge home".to_string()),
            )
        })
    }

    fn next_session_id(&self) -> String {
        loop {
            let id = random_session_id();
            if !self
                .sessions
                .lock()
                .expect("voice registry poisoned")
                .contains_key(&id)
            {
                return id;
            }
        }
    }
}

impl<R, T> Drop for VoiceSessionManager<R, T> {
    fn drop(&mut self) {
        self.start_gate.close();
        self.shutting_down.store(true, Ordering::SeqCst);
        shutdown_session_registries(&self.sessions, &self.provisional, Duration::from_secs(5));
        self.start_gate.wait();
    }
}

struct SessionRunner<T, S>
where
    T: VoiceTranscriber,
    S: VoiceSink,
{
    session_id: String,
    session_dir: PathBuf,
    capture_path: PathBuf,
    language: String,
    model_path: PathBuf,
    config: VoiceRuntimeConfig,
    transcriber: Arc<T>,
    sink: Arc<S>,
    control_rx: std::sync::mpsc::Receiver<Control>,
    state: Arc<Mutex<VoiceSessionPhase>>,
    completion: Arc<Completion>,
    active_transcription: ActiveTranscriptionSlot,
}

impl<T, S> SessionRunner<T, S>
where
    T: VoiceTranscriber,
    S: VoiceSink,
{
    fn run(self, mut recording: Box<dyn ActiveRecording>) {
        let outcome = self.run_inner(&mut recording);
        let _ = recording.stop();

        match outcome {
            Ok(SessionOutcome::Done(text)) => {
                set_state(&self.state, VoiceSessionPhase::Done);
                self.sink
                    .emit(VoiceEvent::final_text(&self.session_id, text.clone()));
                self.completion.complete(VoiceCompletion::done(text));
                cleanup_session_dir(&self.session_dir, self.config.keep_audio);
            }
            Ok(SessionOutcome::Cancelled) => {
                set_state(&self.state, VoiceSessionPhase::Cancelled);
                self.completion.complete(VoiceCompletion::cancelled());
                let _ = std::fs::remove_dir_all(&self.session_dir);
            }
            Err(error) => {
                set_state(&self.state, VoiceSessionPhase::Done);
                let text = error.to_string();
                self.sink
                    .emit(VoiceEvent::error(&self.session_id, text.clone()));
                self.completion.complete(VoiceCompletion::error(text));
                cleanup_session_dir(&self.session_dir, self.config.keep_audio);
            }
        }
    }

    fn run_inner(
        &self,
        _recording: &mut Box<dyn ActiveRecording>,
    ) -> Result<SessionOutcome, VoiceError> {
        set_state(&self.state, VoiceSessionPhase::Recording);
        let mut partials = Vec::new();
        let mut segmenter = Segmenter::new(self.config.segment);
        let mut segment_index = 0usize;

        let exit = loop {
            if let Some(control) = self.poll_control() {
                break control;
            }

            if let Some(wav) = read_capture_for_poll(&self.capture_path) {
                self.sink
                    .emit(VoiceEvent::level(&self.session_id, recent_level(&wav)));
                if let Some(control) = self.process_ready_segments(
                    &wav,
                    &mut segmenter,
                    &mut segment_index,
                    &mut partials,
                )? {
                    break control;
                }
            }

            thread::sleep(self.config.poll_interval);
        };

        if matches!(exit, Control::Cancel) {
            let _ = _recording.stop();
            return Ok(SessionOutcome::Cancelled);
        }

        _recording.stop()?;
        set_state(&self.state, VoiceSessionPhase::Finalizing);
        if !partials.is_empty() {
            if let Some(wav) = read_capture_for_poll(&self.capture_path) {
                if let Some(range) = segmenter.remaining_range(wav.samples.len(), wav.sample_rate) {
                    match self.transcribe_range(&wav, range, segment_index)? {
                        TranscribeResult::Text(text) => {
                            push_partial(&mut partials, text);
                        }
                        TranscribeResult::TextThenStop(text) => {
                            push_partial(&mut partials, text);
                        }
                        TranscribeResult::Control(Control::Cancel) => {
                            return Ok(SessionOutcome::Cancelled);
                        }
                        TranscribeResult::Control(Control::Stop) => {}
                    }
                }
            }
            return Ok(SessionOutcome::Done(join_transcript(&partials)));
        }

        let text = match self.transcribe_path(&self.capture_path)? {
            TranscribeResult::Text(text) => text,
            TranscribeResult::TextThenStop(text) => text,
            TranscribeResult::Control(Control::Cancel) => return Ok(SessionOutcome::Cancelled),
            TranscribeResult::Control(Control::Stop) => String::new(),
        };
        Ok(SessionOutcome::Done(text.trim().to_string()))
    }

    fn process_ready_segments(
        &self,
        wav: &WavData,
        segmenter: &mut Segmenter,
        segment_index: &mut usize,
        partials: &mut Vec<String>,
    ) -> Result<Option<Control>, VoiceError> {
        while let Some(range) = segmenter.next_range(&wav.samples, wav.sample_rate) {
            let text = match self.transcribe_range(wav, range, *segment_index)? {
                TranscribeResult::Text(text) => text,
                TranscribeResult::TextThenStop(text) => {
                    *segment_index += 1;
                    if push_partial(partials, text) {
                        self.sink.emit(VoiceEvent::partial(
                            &self.session_id,
                            join_transcript(partials),
                        ));
                    }
                    return Ok(Some(Control::Stop));
                }
                TranscribeResult::Control(control) => return Ok(Some(control)),
            };
            *segment_index += 1;
            if push_partial(partials, text) {
                self.sink.emit(VoiceEvent::partial(
                    &self.session_id,
                    join_transcript(partials),
                ));
            }
        }
        Ok(None)
    }

    fn transcribe_range(
        &self,
        wav: &WavData,
        range: super::segments::SegmentRange,
        segment_index: usize,
    ) -> Result<TranscribeResult, VoiceError> {
        let segment_path = self
            .session_dir
            .join(format!("segment-{segment_index:04}.wav"));
        write_segment_wav(wav, range.for_transcription(), &segment_path)?;
        self.transcribe_path(&segment_path)
    }

    fn transcribe_path(&self, wav_path: &Path) -> Result<TranscribeResult, VoiceError> {
        if let Some(control) = self.poll_control() {
            return Ok(TranscribeResult::Control(control));
        }
        let job =
            self.transcriber
                .start_transcription(wav_path, &self.language, &self.model_path)?;
        *self
            .active_transcription
            .lock()
            .expect("voice transcription slot poisoned") = Some(Arc::clone(&job));
        if let Some(control) = self.poll_control() {
            job.kill();
            *self
                .active_transcription
                .lock()
                .expect("voice transcription slot poisoned") = None;
            return Ok(TranscribeResult::Control(control));
        }
        let result = job.wait();
        *self
            .active_transcription
            .lock()
            .expect("voice transcription slot poisoned") = None;
        match result {
            Ok(text) => {
                let text = text.trim().to_string();
                match self.poll_control() {
                    Some(Control::Stop) if !text.is_empty() => {
                        Ok(TranscribeResult::TextThenStop(text))
                    }
                    Some(control) => Ok(TranscribeResult::Control(control)),
                    None => Ok(TranscribeResult::Text(text)),
                }
            }
            Err(VoiceError::Interrupted) => {
                if let Some(control) = self.poll_control() {
                    Ok(TranscribeResult::Control(control))
                } else {
                    Err(VoiceError::Interrupted)
                }
            }
            Err(error) => Err(error),
        }
    }

    fn poll_control(&self) -> Option<Control> {
        let mut control = None;
        loop {
            match self.control_rx.try_recv() {
                Ok(Control::Cancel) => control = Some(Control::Cancel),
                Ok(Control::Stop) if control.is_none() => control = Some(Control::Stop),
                Ok(Control::Stop) => {}
                Err(std::sync::mpsc::TryRecvError::Empty) => return control,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return Some(Control::Cancel),
            }
        }
    }
}

#[derive(Clone)]
struct SessionHandle {
    control_tx: std::sync::mpsc::Sender<Control>,
    completion: Arc<Completion>,
    state: Arc<Mutex<VoiceSessionPhase>>,
    join: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    active_transcription: ActiveTranscriptionSlot,
}

type ActiveTranscriptionSlot = Arc<Mutex<Option<Arc<dyn RunningTranscription>>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Control {
    Stop,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionOutcome {
    Done(String),
    Cancelled,
}

enum TranscribeResult {
    Text(String),
    TextThenStop(String),
    Control(Control),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VoiceCompletion {
    transcript: String,
    error: Option<String>,
    cancelled: bool,
}

impl VoiceCompletion {
    fn done(transcript: String) -> Self {
        Self {
            transcript,
            error: None,
            cancelled: false,
        }
    }

    fn error(error: String) -> Self {
        Self {
            transcript: String::new(),
            error: Some(error),
            cancelled: false,
        }
    }

    fn cancelled() -> Self {
        Self {
            transcript: String::new(),
            error: None,
            cancelled: true,
        }
    }

    fn into_stop_result(self) -> Result<String, VoiceError> {
        if self.cancelled {
            return Err(VoiceError::Cancelled);
        }
        if let Some(error) = self.error {
            return Err(VoiceError::Pipeline(error));
        }
        Ok(self.transcript)
    }

    fn into_cancel_result(self) -> Result<(), VoiceError> {
        if let Some(error) = self.error {
            return Err(VoiceError::Pipeline(error));
        }
        Ok(())
    }
}

#[derive(Default)]
struct Completion {
    result: Mutex<Option<VoiceCompletion>>,
    cvar: Condvar,
}

impl Completion {
    fn complete(&self, completion: VoiceCompletion) {
        *self.result.lock().expect("voice completion poisoned") = Some(completion);
        self.cvar.notify_all();
    }

    fn wait(&self, timeout: Duration) -> Option<VoiceCompletion> {
        let started = Instant::now();
        let mut guard = self.result.lock().expect("voice completion poisoned");
        loop {
            if let Some(result) = guard.clone() {
                return Some(result);
            }
            let elapsed = started.elapsed();
            if elapsed >= timeout {
                return None;
            }
            let remaining = timeout - elapsed;
            let (next_guard, wait) = self
                .cvar
                .wait_timeout(guard, remaining)
                .expect("voice completion poisoned");
            guard = next_guard;
            if wait.timed_out() && guard.is_none() {
                return None;
            }
        }
    }
}

pub fn voice_root(home: &Path) -> PathBuf {
    home.join("voice")
}

pub fn sweep_stale_voice_dirs(
    home: &Path,
    stale_after: Duration,
    now: SystemTime,
) -> std::io::Result<usize> {
    let root = voice_root(home);
    if !root.exists() {
        return Ok(0);
    }
    let mut removed = 0usize;
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_dir() {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if now.duration_since(modified).unwrap_or(Duration::ZERO) > stale_after {
            std::fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

fn cleanup_session_dir(session_dir: &Path, keep_audio: bool) {
    if !keep_audio {
        let _ = std::fs::remove_dir_all(session_dir);
    }
}

fn set_state(state: &Mutex<VoiceSessionPhase>, next: VoiceSessionPhase) {
    *state.lock().expect("voice state poisoned") = next;
}

fn join_runner(handle: &SessionHandle) {
    if let Some(join) = handle.join.lock().expect("voice join poisoned").take() {
        let _ = join.join();
    }
}

fn kill_active_transcription(handle: &SessionHandle) {
    if let Some(job) = handle
        .active_transcription
        .lock()
        .expect("voice transcription slot poisoned")
        .clone()
    {
        job.kill();
    }
}

fn drain_sessions(sessions: &Mutex<HashMap<String, SessionHandle>>) -> Vec<SessionHandle> {
    let mut sessions = sessions.lock().expect("voice registry poisoned");
    sessions.drain().map(|(_, handle)| handle).collect()
}

fn shutdown_sessions(
    sessions: &Mutex<HashMap<String, SessionHandle>>,
    timeout: Duration,
) -> (usize, usize) {
    shutdown_handles(drain_sessions(sessions), timeout)
}

fn shutdown_session_registries(
    sessions: &Mutex<HashMap<String, SessionHandle>>,
    provisional: &Mutex<HashMap<String, SessionHandle>>,
    timeout: Duration,
) -> (usize, usize) {
    let mut handles = drain_sessions(sessions);
    handles.extend(drain_sessions(provisional));
    shutdown_handles(handles, timeout)
}

fn shutdown_handles(handles: Vec<SessionHandle>, timeout: Duration) -> (usize, usize) {
    for handle in &handles {
        let _ = handle.control_tx.send(Control::Cancel);
        kill_active_transcription(handle);
    }

    let deadline = Instant::now() + timeout;
    let mut incomplete = 0;
    for handle in &handles {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if handle.completion.wait(remaining).is_some() {
            join_runner(handle);
        } else {
            incomplete += 1;
        }
    }
    (handles.len(), incomplete)
}

fn random_session_id() -> String {
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    let mut id = String::from("voice-");
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut id, "{byte:02x}");
    }
    id
}

fn read_capture_for_poll(path: &Path) -> Option<WavData> {
    read_wav_file(path).ok()
}

fn recent_level(wav: &WavData) -> f32 {
    let tail_len = (wav.sample_rate as usize / 4).min(wav.samples.len());
    rms_level(&wav.samples[wav.samples.len().saturating_sub(tail_len)..])
}

fn push_partial(partials: &mut Vec<String>, text: String) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return false;
    }
    partials.push(text.to_string());
    true
}

fn join_transcript(partials: &[String]) -> String {
    partials
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::voice::segments::{encode_wav_pcm16_mono, TARGET_SAMPLE_RATE};
    use crate::voice::stt::RunningTranscription;
    use std::collections::VecDeque;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Condvar;

    #[derive(Default)]
    struct RecorderGate {
        started: AtomicBool,
    }

    #[derive(Clone)]
    struct BlockingRecorder {
        gate: Arc<RecorderGate>,
        stopped: Arc<AtomicBool>,
    }

    impl RecorderBackend for BlockingRecorder {
        fn start(
            &self,
            capture_path: &Path,
            cancelled: &AtomicBool,
        ) -> Result<Box<dyn ActiveRecording>, VoiceError> {
            if let Some(parent) = capture_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            crate::voice::write_private_file(
                capture_path,
                &encode_wav_pcm16_mono(&samples(1.0), TARGET_SAMPLE_RATE),
            )?;
            self.gate.started.store(true, Ordering::SeqCst);
            while !cancelled.load(Ordering::SeqCst) {
                thread::yield_now();
            }
            self.stopped.store(true, Ordering::SeqCst);
            Err(VoiceError::ShuttingDown)
        }
    }

    #[derive(Clone)]
    struct MockRecorder {
        samples: Vec<i16>,
        stopped: Arc<AtomicBool>,
    }

    impl RecorderBackend for MockRecorder {
        fn start(
            &self,
            capture_path: &Path,
            _cancelled: &AtomicBool,
        ) -> Result<Box<dyn ActiveRecording>, VoiceError> {
            if let Some(parent) = capture_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            crate::voice::write_private_file(
                capture_path,
                &encode_wav_pcm16_mono(&self.samples, TARGET_SAMPLE_RATE),
            )?;
            Ok(Box::new(MockActiveRecording {
                stopped: Arc::clone(&self.stopped),
            }))
        }
    }

    struct MockActiveRecording {
        stopped: Arc<AtomicBool>,
    }

    impl ActiveRecording for MockActiveRecording {
        fn stop(&mut self) -> Result<(), VoiceError> {
            self.stopped.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    #[derive(Clone)]
    struct MockTranscriber {
        outputs: Arc<Mutex<VecDeque<String>>>,
        calls: Arc<Mutex<Vec<PathBuf>>>,
        stopped_probe: Option<Arc<AtomicBool>>,
        observed_stopped: Arc<AtomicBool>,
    }

    impl MockTranscriber {
        fn new(outputs: &[&str]) -> Self {
            Self {
                outputs: Arc::new(Mutex::new(
                    outputs.iter().map(|value| value.to_string()).collect(),
                )),
                calls: Arc::new(Mutex::new(Vec::new())),
                stopped_probe: None,
                observed_stopped: Arc::new(AtomicBool::new(false)),
            }
        }

        fn with_stop_probe(outputs: &[&str], stopped: Arc<AtomicBool>) -> Self {
            Self {
                outputs: Arc::new(Mutex::new(
                    outputs.iter().map(|value| value.to_string()).collect(),
                )),
                calls: Arc::new(Mutex::new(Vec::new())),
                stopped_probe: Some(stopped),
                observed_stopped: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl VoiceTranscriber for MockTranscriber {
        fn prepare(
            &self,
            model_path_override: Option<&Path>,
        ) -> Result<PreparedTranscription, VoiceError> {
            Ok(PreparedTranscription {
                model_path: model_path_override
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from("/tmp/model.bin")),
            })
        }

        fn start_transcription(
            &self,
            wav_path: &Path,
            _language: &str,
            _model_path: &Path,
        ) -> Result<Arc<dyn RunningTranscription>, VoiceError> {
            self.calls.lock().unwrap().push(wav_path.to_path_buf());
            if self
                .stopped_probe
                .as_ref()
                .map(|probe| probe.load(Ordering::SeqCst))
                .unwrap_or(false)
            {
                self.observed_stopped.store(true, Ordering::SeqCst);
            }
            let text = self
                .outputs
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| "tail".to_string());
            Ok(Arc::new(MockJob {
                text: Mutex::new(Some(text)),
                killed: AtomicBool::new(false),
            }))
        }
    }

    struct MockJob {
        text: Mutex<Option<String>>,
        killed: AtomicBool,
    }

    impl RunningTranscription for MockJob {
        fn wait(&self) -> Result<String, VoiceError> {
            if self.killed.load(Ordering::SeqCst) {
                return Err(VoiceError::Interrupted);
            }
            Ok(self.text.lock().unwrap().take().unwrap_or_default())
        }

        fn kill(&self) {
            self.killed.store(true, Ordering::SeqCst);
        }
    }

    #[derive(Clone)]
    struct BlockingTranscriber {
        started: Arc<(Mutex<bool>, Condvar)>,
        killed: Arc<AtomicBool>,
    }

    impl VoiceTranscriber for BlockingTranscriber {
        fn prepare(
            &self,
            model_path_override: Option<&Path>,
        ) -> Result<PreparedTranscription, VoiceError> {
            Ok(PreparedTranscription {
                model_path: model_path_override
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from("/tmp/model.bin")),
            })
        }

        fn start_transcription(
            &self,
            _wav_path: &Path,
            _language: &str,
            _model_path: &Path,
        ) -> Result<Arc<dyn RunningTranscription>, VoiceError> {
            {
                let (lock, cvar) = &*self.started;
                *lock.lock().unwrap() = true;
                cvar.notify_all();
            }
            Ok(Arc::new(BlockingJob {
                killed: Arc::clone(&self.killed),
                cvar: Arc::new(Condvar::new()),
                lock: Arc::new(Mutex::new(false)),
            }))
        }
    }

    struct BlockingJob {
        killed: Arc<AtomicBool>,
        cvar: Arc<Condvar>,
        lock: Arc<Mutex<bool>>,
    }

    impl RunningTranscription for BlockingJob {
        fn wait(&self) -> Result<String, VoiceError> {
            let mut guard = self.lock.lock().unwrap();
            while !self.killed.load(Ordering::SeqCst) {
                guard = self.cvar.wait(guard).unwrap();
            }
            Err(VoiceError::Interrupted)
        }

        fn kill(&self) {
            self.killed.store(true, Ordering::SeqCst);
            self.cvar.notify_all();
        }
    }

    #[derive(Clone)]
    struct GatedTranscriber {
        gate: Arc<WaitGate>,
        text: String,
    }

    impl VoiceTranscriber for GatedTranscriber {
        fn prepare(
            &self,
            model_path_override: Option<&Path>,
        ) -> Result<PreparedTranscription, VoiceError> {
            Ok(PreparedTranscription {
                model_path: model_path_override
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| PathBuf::from("/tmp/model.bin")),
            })
        }

        fn start_transcription(
            &self,
            _wav_path: &Path,
            _language: &str,
            _model_path: &Path,
        ) -> Result<Arc<dyn RunningTranscription>, VoiceError> {
            Ok(Arc::new(GatedJob {
                gate: Arc::clone(&self.gate),
                text: self.text.clone(),
            }))
        }
    }

    #[derive(Default)]
    struct WaitGate {
        entered: (Mutex<bool>, Condvar),
        released: (Mutex<bool>, Condvar),
    }

    struct GatedJob {
        gate: Arc<WaitGate>,
        text: String,
    }

    impl RunningTranscription for GatedJob {
        fn wait(&self) -> Result<String, VoiceError> {
            {
                let (lock, cvar) = &self.gate.entered;
                *lock.lock().unwrap() = true;
                cvar.notify_all();
            }
            let (lock, cvar) = &self.gate.released;
            let guard = lock.lock().unwrap();
            let (guard, _) = cvar
                .wait_timeout_while(guard, Duration::from_secs(2), |released| !*released)
                .unwrap();
            assert!(*guard, "gated transcription was not released");
            Ok(self.text.clone())
        }

        fn kill(&self) {
            release_gate(&self.gate);
        }
    }

    struct TempHome(PathBuf);

    impl TempHome {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "pf-voice-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn samples(seconds: f32) -> Vec<i16> {
        vec![8000; (seconds * TARGET_SAMPLE_RATE as f32) as usize]
    }

    fn test_config(keep_audio: bool) -> VoiceRuntimeConfig {
        VoiceRuntimeConfig {
            poll_interval: Duration::from_millis(10),
            keep_audio,
            segment: SegmentConfig::default(),
        }
    }

    #[test]
    fn stop_returns_segment_transcript_and_removes_temp_dir() {
        let home = TempHome::new("stop");
        let stopped = Arc::new(AtomicBool::new(false));
        let transcriber = MockTranscriber::new(&["hello"]);
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(5.2),
                stopped: Arc::clone(&stopped),
            },
            transcriber.clone(),
            test_config(false),
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_for_sink = Arc::clone(&events);
        let session_id = manager
            .start(
                VoiceStartRequest::new(Some("en".into()), Some(PathBuf::from("/tmp/model.bin"))),
                move |event| events_for_sink.lock().unwrap().push(event),
            )
            .unwrap();

        wait_until(Duration::from_secs(2), || {
            events.lock().unwrap().iter().any(|event| {
                event.kind == super::super::VoiceEventKind::Partial
                    && event.text.as_deref() == Some("hello")
            })
        });

        assert_eq!(
            manager.phase(&session_id),
            Some(VoiceSessionPhase::Recording)
        );
        let transcript = manager.stop(&session_id, Duration::from_secs(2)).unwrap();

        assert_eq!(transcript, "hello");
        assert!(stopped.load(Ordering::SeqCst));
        assert_eq!(manager.active_session_count(), 0);
        assert!(!voice_root(&home.0).join(&session_id).exists());
    }

    #[test]
    fn stop_falls_back_to_full_file_when_no_segments_complete() {
        let home = TempHome::new("fallback");
        let stopped = Arc::new(AtomicBool::new(false));
        let transcriber = MockTranscriber::with_stop_probe(&["full file"], Arc::clone(&stopped));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(1.0),
                stopped: Arc::clone(&stopped),
            },
            transcriber.clone(),
            test_config(false),
        );
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
            .unwrap();

        let transcript = manager.stop(&session_id, Duration::from_secs(2)).unwrap();

        assert_eq!(transcript, "full file");
        assert!(stopped.load(Ordering::SeqCst));
        assert!(transcriber.observed_stopped.load(Ordering::SeqCst));
        let calls = transcriber.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].ends_with("capture.wav"));
    }

    #[test]
    fn cancel_deletes_temp_dir_even_when_keep_audio_is_enabled() {
        let home = TempHome::new("cancel");
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(1.0),
                stopped,
            },
            MockTranscriber::new(&["unused"]),
            test_config(true),
        );
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
            .unwrap();
        let dir = voice_root(&home.0).join(&session_id);
        assert!(dir.exists());

        manager.cancel(&session_id).unwrap();

        assert!(!dir.exists());
        assert_eq!(manager.active_session_count(), 0);
    }

    #[test]
    fn stop_preserves_audio_when_keep_audio_is_enabled() {
        let home = TempHome::new("keep");
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(1.0),
                stopped,
            },
            MockTranscriber::new(&["full file"]),
            test_config(true),
        );
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
            .unwrap();
        let dir = voice_root(&home.0).join(&session_id);

        let _ = manager.stop(&session_id, Duration::from_secs(2)).unwrap();

        assert!(dir.exists());
    }

    #[cfg(unix)]
    #[test]
    fn session_audio_paths_are_private_when_preserved() {
        let home = TempHome::new("permissions");
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(5.2),
                stopped,
            },
            MockTranscriber::new(&["hello"]),
            test_config(true),
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_for_sink = Arc::clone(&events);
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                move |event| events_for_sink.lock().unwrap().push(event),
            )
            .unwrap();
        let dir = voice_root(&home.0).join(&session_id);
        wait_until(Duration::from_secs(2), || {
            events.lock().unwrap().iter().any(|event| {
                event.kind == super::super::VoiceEventKind::Partial
                    && event.text.as_deref() == Some("hello")
            })
        });

        let _ = manager.stop(&session_id, Duration::from_secs(2)).unwrap();

        assert_eq!(mode_of(&dir), 0o700);
        assert_eq!(mode_of(&dir.join("capture.wav")), 0o600);
        assert_eq!(mode_of(&dir.join("segment-0000.wav")), 0o600);
    }

    #[test]
    fn shutdown_cancels_active_session_and_removes_temp_dir() {
        let home = TempHome::new("shutdown");
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(1.0),
                stopped: Arc::clone(&stopped),
            },
            MockTranscriber::new(&["unused"]),
            test_config(true),
        );
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
            .unwrap();
        let dir = voice_root(&home.0).join(&session_id);
        assert!(dir.exists());

        manager.shutdown();

        assert!(stopped.load(Ordering::SeqCst));
        assert_eq!(manager.active_session_count(), 0);
        assert!(!dir.exists());
    }

    #[test]
    fn shutdown_rejects_a_voice_start_that_finishes_recording_setup_late() {
        let home = TempHome::new("shutdown-start-race");
        let gate = Arc::new(RecorderGate::default());
        let stopped = Arc::new(AtomicBool::new(false));
        let manager = Arc::new(VoiceSessionManager::with_config(
            home.0.clone(),
            BlockingRecorder {
                gate: Arc::clone(&gate),
                stopped: Arc::clone(&stopped),
            },
            MockTranscriber::new(&["unused"]),
            test_config(true),
        ));
        let manager_for_start = Arc::clone(&manager);
        let start = thread::spawn(move || {
            manager_for_start.start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
        });
        wait_until(Duration::from_secs(1), || {
            gate.started.load(Ordering::SeqCst)
        });

        assert_eq!(manager.shutdown(), 0);
        let result = start.join().unwrap();

        assert!(matches!(result, Err(VoiceError::ShuttingDown)));
        assert!(stopped.load(Ordering::SeqCst));
        assert_eq!(manager.active_session_count(), 0);
    }

    #[test]
    fn shutdown_sessions_share_one_deadline_and_report_incomplete_cleanup() {
        let sessions = Mutex::new(HashMap::new());
        let mut receivers = Vec::new();
        for id in ["one", "two"] {
            let (control_tx, control_rx) = std::sync::mpsc::channel();
            receivers.push(control_rx);
            sessions.lock().unwrap().insert(
                id.to_string(),
                SessionHandle {
                    control_tx,
                    completion: Arc::new(Completion::default()),
                    state: Arc::new(Mutex::new(VoiceSessionPhase::Recording)),
                    join: Arc::new(Mutex::new(None)),
                    active_transcription: Arc::new(Mutex::new(None)),
                },
            );
        }

        let started = Instant::now();
        let result = shutdown_sessions(&sessions, Duration::from_millis(80));
        let elapsed = started.elapsed();

        assert_eq!(result, (2, 2));
        assert!(
            elapsed < Duration::from_millis(140),
            "two voice sessions consumed serial timeouts: {elapsed:?}"
        );
        assert!(sessions.lock().unwrap().is_empty());
        assert_eq!(receivers.len(), 2);
    }

    #[test]
    fn cancel_kills_active_transcription() {
        let home = TempHome::new("cancel-transcription");
        let stopped = Arc::new(AtomicBool::new(false));
        let started = Arc::new((Mutex::new(false), Condvar::new()));
        let killed = Arc::new(AtomicBool::new(false));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(5.2),
                stopped,
            },
            BlockingTranscriber {
                started: Arc::clone(&started),
                killed: Arc::clone(&killed),
            },
            test_config(false),
        );
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
            .unwrap();
        wait_for_blocking_transcription(&started);

        let begun = Instant::now();
        manager.cancel(&session_id).unwrap();

        assert!(begun.elapsed() < Duration::from_secs(1));
        assert!(killed.load(Ordering::SeqCst));
        assert_eq!(manager.active_session_count(), 0);
    }

    #[test]
    fn stop_timeout_kills_active_transcription() {
        let home = TempHome::new("stop-timeout");
        let stopped = Arc::new(AtomicBool::new(false));
        let started = Arc::new((Mutex::new(false), Condvar::new()));
        let killed = Arc::new(AtomicBool::new(false));
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(5.2),
                stopped,
            },
            BlockingTranscriber {
                started: Arc::clone(&started),
                killed: Arc::clone(&killed),
            },
            test_config(false),
        );
        let session_id = manager
            .start(
                VoiceStartRequest::new(None, Some(PathBuf::from("/tmp/model.bin"))),
                |_| {},
            )
            .unwrap();
        wait_for_blocking_transcription(&started);

        let result = manager.stop(&session_id, Duration::from_millis(100));

        assert!(matches!(result, Err(VoiceError::Timeout(_))));
        assert!(killed.load(Ordering::SeqCst));
        assert_eq!(manager.active_session_count(), 0);
    }

    #[test]
    fn stop_after_transcription_completion_keeps_segment_text() {
        let home = TempHome::new("stop-after-ok");
        let session_dir = voice_root(&home.0).join("session");
        std::fs::create_dir_all(&session_dir).unwrap();
        let wav = WavData {
            sample_rate: TARGET_SAMPLE_RATE,
            channels: 1,
            samples: samples(5.2),
        };
        let gate = Arc::new(WaitGate::default());
        let (control_tx, control_rx) = std::sync::mpsc::channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_for_sink = Arc::clone(&events);
        let runner = SessionRunner {
            session_id: "session".to_string(),
            session_dir,
            capture_path: PathBuf::from("capture.wav"),
            language: "en".to_string(),
            model_path: PathBuf::from("/tmp/model.bin"),
            config: test_config(true),
            transcriber: Arc::new(GatedTranscriber {
                gate: Arc::clone(&gate),
                text: "hello".to_string(),
            }),
            sink: Arc::new(move |event| events_for_sink.lock().unwrap().push(event)),
            control_rx,
            state: Arc::new(Mutex::new(VoiceSessionPhase::Recording)),
            completion: Arc::new(Completion::default()),
            active_transcription: Arc::new(Mutex::new(None)),
        };

        let handle = thread::spawn(move || {
            let mut segmenter = Segmenter::new(SegmentConfig::default());
            let mut segment_index = 0usize;
            let mut partials = Vec::new();
            runner
                .process_ready_segments(&wav, &mut segmenter, &mut segment_index, &mut partials)
                .map(|control| (control, partials))
        });
        wait_for_gate_entry(&gate);
        control_tx.send(Control::Stop).unwrap();
        release_gate(&gate);
        let (control, partials) = handle.join().unwrap().unwrap();

        assert_eq!(control, Some(Control::Stop));
        assert_eq!(partials, vec!["hello".to_string()]);
        assert!(events.lock().unwrap().iter().any(|event| {
            event.kind == super::super::VoiceEventKind::Partial
                && event.text.as_deref() == Some("hello")
        }));
    }

    #[test]
    fn stale_sweep_removes_old_session_dirs() {
        let home = TempHome::new("sweep");
        let root = voice_root(&home.0);
        let old = root.join("old");
        let fresh = root.join("fresh");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&fresh).unwrap();
        set_mtime(
            &old,
            SystemTime::now() - Duration::from_secs(3 * 24 * 60 * 60),
        );

        let removed =
            sweep_stale_voice_dirs(&home.0, STALE_SESSION_AGE, SystemTime::now()).unwrap();

        assert_eq!(removed, 1);
        assert!(!old.exists());
        assert!(fresh.exists());
    }

    fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) {
        let started = Instant::now();
        while started.elapsed() < timeout {
            if condition() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(condition(), "condition was not met before timeout");
    }

    fn wait_for_blocking_transcription(started: &Arc<(Mutex<bool>, Condvar)>) {
        let (lock, cvar) = &**started;
        let guard = lock.lock().unwrap();
        let (guard, _) = cvar
            .wait_timeout_while(guard, Duration::from_secs(2), |started| !*started)
            .unwrap();
        assert!(*guard, "transcription did not start before timeout");
    }

    fn wait_for_gate_entry(gate: &Arc<WaitGate>) {
        let (lock, cvar) = &gate.entered;
        let guard = lock.lock().unwrap();
        let (guard, _) = cvar
            .wait_timeout_while(guard, Duration::from_secs(2), |entered| !*entered)
            .unwrap();
        assert!(*guard, "gated transcription did not start before timeout");
    }

    fn release_gate(gate: &Arc<WaitGate>) {
        let (lock, cvar) = &gate.released;
        *lock.lock().unwrap() = true;
        cvar.notify_all();
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    fn set_mtime(path: &Path, time: SystemTime) {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let duration = time.duration_since(SystemTime::UNIX_EPOCH).unwrap();
        let times = [
            libc::timespec {
                tv_sec: duration.as_secs() as libc::time_t,
                tv_nsec: duration.subsec_nanos() as libc::c_long,
            },
            libc::timespec {
                tv_sec: duration.as_secs() as libc::time_t,
                tv_nsec: duration.subsec_nanos() as libc::c_long,
            },
        ];
        let c_path = CString::new(path.as_os_str().as_bytes()).unwrap();
        let rc = unsafe { libc::utimensat(libc::AT_FDCWD, c_path.as_ptr(), times.as_ptr(), 0) };
        assert_eq!(rc, 0);
    }

    #[cfg(not(unix))]
    fn set_mtime(_path: &Path, _time: SystemTime) {}
}

#[cfg(all(test, not(target_os = "linux")))]
mod non_linux_tests {
    use super::*;

    #[test]
    fn start_returns_unsupported_platform() {
        let manager = VoiceSessionManager::new();
        let result = manager.start(VoiceStartRequest::new(None, None), |_| {});

        assert!(matches!(result, Err(VoiceError::UnsupportedPlatform)));
    }
}
