use std::path::{Path, PathBuf};

use serde::Serialize;

pub mod recorder;
pub mod segments;
pub mod session;
pub mod stt;

pub use recorder::{ActiveRecording, PwRecordBackend, RecorderBackend};
pub use session::{VoiceSessionManager, VoiceSessionPhase, VoiceStartRequest};
pub use stt::{PreparedTranscription, VoiceTranscriber, WhisperCliTranscriber};

pub const DEFAULT_LANGUAGE: &str = "en";
pub const DEFAULT_MODEL_RELATIVE_PATH: &str = ".local/share/whisper.cpp/models/ggml-base.bin";
pub const KEEP_AUDIO_ENV: &str = "PICKFORGE_KEEP_VOICE_AUDIO";
pub const LEGACY_KEEP_AUDIO_ENV: &str = "PICKFORGE_VOICE_KEEP_AUDIO";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCommandSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl LocalCommandSpec {
    pub fn new(program: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
        }
    }

    pub fn parts(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.program.as_str()).chain(self.args.iter().map(String::as_str))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceEventKind {
    Partial,
    Final,
    Error,
    Level,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEvent {
    pub kind: VoiceEventKind,
    pub session_id: String,
    pub text: Option<String>,
    pub level: Option<f32>,
}

impl VoiceEvent {
    pub fn partial(session_id: &str, text: String) -> Self {
        Self {
            kind: VoiceEventKind::Partial,
            session_id: session_id.to_string(),
            text: Some(text),
            level: None,
        }
    }

    pub fn final_text(session_id: &str, text: String) -> Self {
        Self {
            kind: VoiceEventKind::Final,
            session_id: session_id.to_string(),
            text: Some(text),
            level: None,
        }
    }

    pub fn error(session_id: &str, text: String) -> Self {
        Self {
            kind: VoiceEventKind::Error,
            session_id: session_id.to_string(),
            text: Some(text),
            level: None,
        }
    }

    pub fn level(session_id: &str, level: f32) -> Self {
        Self {
            kind: VoiceEventKind::Level,
            session_id: session_id.to_string(),
            text: None,
            level: Some(level),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum VoiceDependency {
    PwRecord,
    WhisperCli,
    Model,
}

impl VoiceDependency {
    pub fn as_str(&self) -> &'static str {
        match self {
            VoiceDependency::PwRecord => "pw-record",
            VoiceDependency::WhisperCli => "whisper-cli",
            VoiceDependency::Model => "model",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAvailability {
    pub available: bool,
    pub missing: Vec<String>,
    pub model_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum VoiceError {
    #[error("local dictation is supported on Linux only")]
    UnsupportedPlatform,
    #[error(
        "PipeWire is required for local dictation: install pw-record and make sure it is on PATH"
    )]
    MissingPwRecord,
    #[error("pw-record exited immediately; check that PipeWire and the default microphone are available")]
    RecorderExited,
    #[error("whisper-cli is required for local dictation: install whisper.cpp and make sure whisper-cli is on PATH")]
    MissingWhisperCli,
    #[error("whisper.cpp model not found at {expected}; run the PickScribe installer to install ggml-base.bin there")]
    MissingModel { expected: String },
    #[error("HOME is not set; cannot resolve the default whisper.cpp model path")]
    MissingHome,
    #[error("voice session manager is shutting down")]
    ShuttingDown,
    #[error("voice session {0} not found")]
    SessionNotFound(String),
    #[error("voice session {0} did not finish before the timeout")]
    Timeout(String),
    #[error("voice session was cancelled")]
    Cancelled,
    #[error("voice transcription was interrupted")]
    Interrupted,
    #[error("voice pipeline failed: {0}")]
    Pipeline(String),
    #[error("wav parse failed: {0}")]
    Wav(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub trait VoiceSink: Send + Sync + 'static {
    fn emit(&self, event: VoiceEvent);
}

impl<F> VoiceSink for F
where
    F: Fn(VoiceEvent) + Send + Sync + 'static,
{
    fn emit(&self, event: VoiceEvent) {
        self(event)
    }
}

pub fn default_model_path() -> Result<PathBuf, VoiceError> {
    let home = std::env::var("HOME")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or(VoiceError::MissingHome)?;
    Ok(PathBuf::from(home).join(DEFAULT_MODEL_RELATIVE_PATH))
}

pub fn default_model_path_for_home(home: &Path) -> PathBuf {
    home.join(DEFAULT_MODEL_RELATIVE_PATH)
}

pub fn keep_audio_from_env() -> bool {
    let enabled = |key: &str| {
        std::env::var(key)
            .ok()
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
    };
    enabled(KEEP_AUDIO_ENV) || enabled(LEGACY_KEEP_AUDIO_ENV)
}

pub fn voice_availability(model_path_override: Option<&Path>) -> VoiceAvailability {
    #[cfg(not(target_os = "linux"))]
    {
        let model_path = model_path_override
            .map(Path::to_path_buf)
            .or_else(|| default_model_path().ok());
        return VoiceAvailability {
            available: false,
            missing: Vec::new(),
            model_path: model_path.map(|path| path.to_string_lossy().into_owned()),
            error: Some(VoiceError::UnsupportedPlatform.to_string()),
        };
    }

    #[cfg(target_os = "linux")]
    {
        use crate::process::is_on_user_path;

        let mut missing = Vec::new();
        if !is_on_user_path("pw-record") {
            missing.push(VoiceDependency::PwRecord.as_str().to_string());
        }
        if !is_on_user_path("whisper-cli") {
            missing.push(VoiceDependency::WhisperCli.as_str().to_string());
        }

        let model_path = model_path_override
            .map(Path::to_path_buf)
            .or_else(|| default_model_path().ok());
        if model_path
            .as_ref()
            .map(|path| !path.is_file())
            .unwrap_or(true)
        {
            missing.push(VoiceDependency::Model.as_str().to_string());
        }

        VoiceAvailability {
            available: missing.is_empty(),
            missing,
            model_path: model_path.map(|path| path.to_string_lossy().into_owned()),
            error: None,
        }
    }
}

pub(crate) fn create_private_dir_all(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(crate) fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        create_private_dir_all(parent)?;
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(bytes)?;
        return tighten_private_file(path);
    }

    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes)?;
        tighten_private_file(path)
    }
}

pub(crate) fn tighten_private_file(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod local_only_tests {
    use super::*;
    use crate::voice::recorder::pw_record_argv;
    use crate::voice::stt::whisper_argv;

    #[test]
    fn voice_argv_builders_are_local_only() {
        let capture = PathBuf::from("/home/dev/.pickforge/voice/s/capture.wav");
        let model = PathBuf::from("/home/dev/.local/share/whisper.cpp/models/ggml-base.bin");
        let rec = pw_record_argv(&capture);
        let stt = whisper_argv(&model, &capture, "en");

        for spec in [&rec, &stt] {
            assert!(matches!(spec.program.as_str(), "pw-record" | "whisper-cli"));
            for part in spec.parts() {
                let lower = part.to_ascii_lowercase();
                assert!(!lower.contains("http://"));
                assert!(!lower.contains("https://"));
                assert!(!lower.contains("api."));
                assert!(!matches!(lower.as_str(), "curl" | "wget" | "npx"));
            }
        }
    }
}
