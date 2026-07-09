use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{default_model_path, LocalCommandSpec, VoiceError};

const WHISPER_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedTranscription {
    pub model_path: PathBuf,
}

pub trait VoiceTranscriber: Send + Sync + 'static {
    fn prepare(
        &self,
        model_path_override: Option<&Path>,
    ) -> Result<PreparedTranscription, VoiceError>;

    fn transcribe(
        &self,
        wav_path: &Path,
        language: &str,
        model_path: &Path,
    ) -> Result<String, VoiceError>;
}

#[derive(Debug, Clone, Default)]
pub struct WhisperCliTranscriber;

impl VoiceTranscriber for WhisperCliTranscriber {
    fn prepare(
        &self,
        model_path_override: Option<&Path>,
    ) -> Result<PreparedTranscription, VoiceError> {
        if !crate::process::is_on_user_path("whisper-cli") {
            return Err(VoiceError::MissingWhisperCli);
        }
        Ok(PreparedTranscription {
            model_path: resolve_model_path(model_path_override)?,
        })
    }

    fn transcribe(
        &self,
        wav_path: &Path,
        language: &str,
        model_path: &Path,
    ) -> Result<String, VoiceError> {
        transcribe_with_whisper(model_path, wav_path, language)
    }
}

pub fn resolve_model_path(model_path_override: Option<&Path>) -> Result<PathBuf, VoiceError> {
    let path = match model_path_override {
        Some(path) => path.to_path_buf(),
        None => default_model_path()?,
    };
    if path.is_file() {
        Ok(path)
    } else {
        Err(VoiceError::MissingModel {
            expected: path.to_string_lossy().into_owned(),
        })
    }
}

pub fn whisper_argv(model_path: &Path, wav_path: &Path, language: &str) -> LocalCommandSpec {
    LocalCommandSpec::new(
        "whisper-cli",
        vec![
            "--model".to_string(),
            model_path.to_string_lossy().into_owned(),
            "--file".to_string(),
            wav_path.to_string_lossy().into_owned(),
            "--output-txt".to_string(),
            "--language".to_string(),
            normalized_language(language),
        ],
    )
}

pub fn whisper_txt_output_path(wav_path: &Path) -> PathBuf {
    let mut text = wav_path.as_os_str().to_os_string();
    text.push(".txt");
    PathBuf::from(text)
}

pub fn parse_whisper_txt(contents: &str) -> String {
    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(strip_timestamp_prefix)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn transcribe_with_whisper(
    model_path: &Path,
    wav_path: &Path,
    language: &str,
) -> Result<String, VoiceError> {
    let spec = whisper_argv(model_path, wav_path, language);
    let refs = spec.args.iter().map(String::as_str).collect::<Vec<_>>();
    let outcome = crate::process::run_timeout(&spec.program, &refs, None, None, WHISPER_TIMEOUT)
        .map_err(|error| match error {
            crate::process::RunError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
                VoiceError::MissingWhisperCli
            }
            crate::process::RunError::Io(io) => VoiceError::Io(io),
            crate::process::RunError::Timeout(duration) => {
                VoiceError::Pipeline(format!("whisper-cli timed out after {duration:?}"))
            }
        })?;

    if !outcome.success() {
        let stderr = String::from_utf8_lossy(&outcome.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(VoiceError::Pipeline(if detail.is_empty() {
            format!("whisper-cli exited with {:?}", outcome.code)
        } else {
            detail
        }));
    }

    let txt_path = whisper_txt_output_path(wav_path);
    let contents = std::fs::read_to_string(&txt_path)?;
    Ok(parse_whisper_txt(&contents))
}

fn normalized_language(language: &str) -> String {
    let trimmed = language.trim();
    if trimmed.is_empty() {
        super::DEFAULT_LANGUAGE.to_string()
    } else {
        trimmed.to_string()
    }
}

fn strip_timestamp_prefix(line: &str) -> &str {
    let trimmed = line.trim();
    if trimmed.starts_with('[') {
        if let Some(end) = trimmed.find(']') {
            return trimmed[end + 1..].trim();
        }
    }
    trimmed
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../fixtures/voice/whisper-output.txt");

    #[test]
    fn parses_whisper_txt_fixture() {
        assert_eq!(
            parse_whisper_txt(FIXTURE),
            "hello PickForge this is local dictation"
        );
    }

    #[test]
    fn empty_language_defaults_to_english() {
        let spec = whisper_argv(
            Path::new("/home/dev/model.bin"),
            Path::new("/home/dev/capture.wav"),
            " ",
        );
        assert_eq!(spec.args.last().map(String::as_str), Some("en"));
    }

    #[test]
    fn txt_output_path_appends_txt_to_wav_path() {
        assert_eq!(
            whisper_txt_output_path(Path::new("/tmp/segment.wav")),
            PathBuf::from("/tmp/segment.wav.txt")
        );
    }
}
