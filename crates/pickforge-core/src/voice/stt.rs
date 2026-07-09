use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use super::{default_model_path, tighten_private_file, LocalCommandSpec, VoiceError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedTranscription {
    pub model_path: PathBuf,
}

pub trait VoiceTranscriber: Send + Sync + 'static {
    fn prepare(
        &self,
        model_path_override: Option<&Path>,
    ) -> Result<PreparedTranscription, VoiceError>;

    fn start_transcription(
        &self,
        wav_path: &Path,
        language: &str,
        model_path: &Path,
    ) -> Result<std::sync::Arc<dyn RunningTranscription>, VoiceError>;
}

pub trait RunningTranscription: Send + Sync + 'static {
    fn wait(&self) -> Result<String, VoiceError>;
    fn kill(&self);
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

    fn start_transcription(
        &self,
        wav_path: &Path,
        language: &str,
        model_path: &Path,
    ) -> Result<std::sync::Arc<dyn RunningTranscription>, VoiceError> {
        start_whisper_job(model_path, wav_path, language)
            .map(|job| std::sync::Arc::new(job) as std::sync::Arc<dyn RunningTranscription>)
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

fn start_whisper_job(
    model_path: &Path,
    wav_path: &Path,
    language: &str,
) -> Result<WhisperCliJob, VoiceError> {
    let spec = whisper_argv(model_path, wav_path, language);
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.env_clear();
    for (key, value) in crate::process::user_shell_environment() {
        command.env(key, value);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        unsafe {
            command.pre_exec(|| {
                libc::umask(0o177);
                Ok(())
            });
        }
    }

    let child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            VoiceError::MissingWhisperCli
        } else {
            VoiceError::Io(error)
        }
    })?;
    Ok(WhisperCliJob {
        pid: child.id(),
        child: Mutex::new(Some(child)),
        txt_path: whisper_txt_output_path(wav_path),
        killed: AtomicBool::new(false),
    })
}

struct WhisperCliJob {
    pid: u32,
    child: Mutex<Option<Child>>,
    txt_path: PathBuf,
    killed: AtomicBool,
}

impl RunningTranscription for WhisperCliJob {
    fn wait(&self) -> Result<String, VoiceError> {
        let child = self
            .child
            .lock()
            .expect("whisper child poisoned")
            .take();
        let Some(child) = child else {
            return Err(VoiceError::Interrupted);
        };
        let outcome = child.wait_with_output()?;
        if self.killed.load(Ordering::SeqCst) {
            return Err(VoiceError::Interrupted);
        }
        parse_whisper_outcome(outcome, &self.txt_path)
    }

    fn kill(&self) {
        self.killed.store(true, Ordering::SeqCst);
        kill_process_group(self.pid);
    }
}

fn parse_whisper_outcome(outcome: Output, txt_path: &Path) -> Result<String, VoiceError> {
    if !outcome.status.success() {
        let stderr = String::from_utf8_lossy(&outcome.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(VoiceError::Pipeline(if detail.is_empty() {
            format!("whisper-cli exited with {:?}", outcome.status.code())
        } else {
            detail
        }));
    }

    tighten_private_file(txt_path)?;
    let contents = std::fs::read_to_string(txt_path)?;
    Ok(parse_whisper_txt(&contents))
}

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
