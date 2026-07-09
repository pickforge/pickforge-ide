use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use rand::RngCore;

use super::recorder::{ActiveRecording, PwRecordBackend, RecorderBackend};
use super::segments::{
    read_wav_file, rms_level, write_segment_wav, SegmentConfig, Segmenter, WavData,
};
use super::stt::{PreparedTranscription, VoiceTranscriber, WhisperCliTranscriber};
use super::{
    keep_audio_from_env, DEFAULT_LANGUAGE, VoiceError, VoiceEvent, VoiceSink,
};

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

#[derive(Clone)]
pub struct VoiceSessionManager<R = PwRecordBackend, T = WhisperCliTranscriber> {
    home: Option<PathBuf>,
    home_error: Option<String>,
    recorder: Arc<R>,
    transcriber: Arc<T>,
    sessions: Arc<Mutex<HashMap<String, SessionHandle>>>,
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
            recorder: Arc::new(PwRecordBackend),
            transcriber: Arc::new(WhisperCliTranscriber),
            sessions: Arc::new(Mutex::new(HashMap::new())),
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
            config,
        };
        let _ = manager.sweep_stale_sessions();
        manager
    }

    pub fn start<S>(&self, request: VoiceStartRequest, sink: S) -> Result<String, VoiceError>
    where
        S: VoiceSink,
    {
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
            std::fs::create_dir_all(&session_dir)?;

            let recording = match self.recorder.start(&capture_path) {
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
            let handle = SessionHandle {
                control_tx,
                completion: Arc::clone(&completion),
                state: Arc::clone(&state),
                join: Arc::clone(&join),
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
            self.sessions
                .lock()
                .expect("voice registry poisoned")
                .insert(session_id.clone(), handle);
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
        let completion = handle
            .completion
            .wait(timeout)
            .ok_or_else(|| VoiceError::Timeout(session_id.to_string()))?;
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
        self.sessions
            .lock()
            .expect("voice registry poisoned")
            .len()
    }

    pub fn sweep_stale_sessions(&self) -> Result<usize, VoiceError> {
        let home = self.home_dir()?;
        sweep_stale_voice_dirs(&home, STALE_SESSION_AGE, SystemTime::now()).map_err(VoiceError::Io)
    }

    fn home_dir(&self) -> Result<PathBuf, VoiceError> {
        self.home
            .clone()
            .ok_or_else(|| VoiceError::Pipeline(self.home_error.clone().unwrap_or_else(|| {
                "cannot resolve PickForge home".to_string()
            })))
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
                self.sink.emit(VoiceEvent::final_text(&self.session_id, text.clone()));
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
                self.sink.emit(VoiceEvent::error(&self.session_id, text.clone()));
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
            match self.control_rx.try_recv() {
                Ok(Control::Stop) => break Control::Stop,
                Ok(Control::Cancel) => break Control::Cancel,
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break Control::Cancel,
            }

            if let Some(wav) = read_capture_for_poll(&self.capture_path) {
                self.sink
                    .emit(VoiceEvent::level(&self.session_id, recent_level(&wav)));
                self.process_ready_segments(
                    &wav,
                    &mut segmenter,
                    &mut segment_index,
                    &mut partials,
                )?;
            }

            thread::sleep(self.config.poll_interval);
        };

        if matches!(exit, Control::Cancel) {
            return Ok(SessionOutcome::Cancelled);
        }

        set_state(&self.state, VoiceSessionPhase::Finalizing);
        if !partials.is_empty() {
            if let Some(wav) = read_capture_for_poll(&self.capture_path) {
                if let Some(range) = segmenter.remaining_range(wav.samples.len(), wav.sample_rate) {
                    let text = self.transcribe_range(&wav, range, segment_index)?;
                    push_partial(&mut partials, text);
                }
            }
            return Ok(SessionOutcome::Done(join_transcript(&partials)));
        }

        let text = self
            .transcriber
            .transcribe(&self.capture_path, &self.language, &self.model_path)?;
        Ok(SessionOutcome::Done(text.trim().to_string()))
    }

    fn process_ready_segments(
        &self,
        wav: &WavData,
        segmenter: &mut Segmenter,
        segment_index: &mut usize,
        partials: &mut Vec<String>,
    ) -> Result<(), VoiceError> {
        while let Some(range) = segmenter.next_range(&wav.samples, wav.sample_rate) {
            let text = self.transcribe_range(wav, range, *segment_index)?;
            *segment_index += 1;
            if push_partial(partials, text) {
                self.sink
                    .emit(VoiceEvent::partial(&self.session_id, join_transcript(partials)));
            }
        }
        Ok(())
    }

    fn transcribe_range(
        &self,
        wav: &WavData,
        range: super::segments::SegmentRange,
        segment_index: usize,
    ) -> Result<String, VoiceError> {
        let segment_path = self
            .session_dir
            .join(format!("segment-{segment_index:04}.wav"));
        write_segment_wav(wav, range, &segment_path)?;
        self.transcriber
            .transcribe(&segment_path, &self.language, &self.model_path)
            .map(|text| text.trim().to_string())
    }
}

#[derive(Clone)]
struct SessionHandle {
    control_tx: std::sync::mpsc::Sender<Control>,
    completion: Arc<Completion>,
    state: Arc<Mutex<VoiceSessionPhase>>,
    join: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::segments::{encode_wav_pcm16_mono, TARGET_SAMPLE_RATE};
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Clone)]
    struct MockRecorder {
        samples: Vec<i16>,
        stopped: Arc<AtomicBool>,
    }

    impl RecorderBackend for MockRecorder {
        fn start(&self, capture_path: &Path) -> Result<Box<dyn ActiveRecording>, VoiceError> {
            if let Some(parent) = capture_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(
                capture_path,
                encode_wav_pcm16_mono(&self.samples, TARGET_SAMPLE_RATE),
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
    }

    impl MockTranscriber {
        fn new(outputs: &[&str]) -> Self {
            Self {
                outputs: Arc::new(Mutex::new(
                    outputs.iter().map(|value| value.to_string()).collect(),
                )),
                calls: Arc::new(Mutex::new(Vec::new())),
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

        fn transcribe(
            &self,
            wav_path: &Path,
            _language: &str,
            _model_path: &Path,
        ) -> Result<String, VoiceError> {
            self.calls
                .lock()
                .unwrap()
                .push(wav_path.to_path_buf());
            Ok(self
                .outputs
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| "tail".to_string()))
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

        assert_eq!(manager.phase(&session_id), Some(VoiceSessionPhase::Recording));
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
        let transcriber = MockTranscriber::new(&["full file"]);
        let manager = VoiceSessionManager::with_config(
            home.0.clone(),
            MockRecorder {
                samples: samples(1.0),
                stopped,
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

    #[test]
    fn stale_sweep_removes_old_session_dirs() {
        let home = TempHome::new("sweep");
        let root = voice_root(&home.0);
        let old = root.join("old");
        let fresh = root.join("fresh");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&fresh).unwrap();
        set_mtime(&old, SystemTime::now() - Duration::from_secs(3 * 24 * 60 * 60));

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
