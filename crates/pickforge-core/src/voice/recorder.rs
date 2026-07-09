use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::{LocalCommandSpec, VoiceError};

pub trait ActiveRecording: Send {
    fn stop(&mut self) -> Result<(), VoiceError>;
}

pub trait RecorderBackend: Send + Sync + 'static {
    fn start(&self, capture_path: &Path) -> Result<Box<dyn ActiveRecording>, VoiceError>;
}

#[derive(Debug, Clone, Default)]
pub struct PwRecordBackend;

impl RecorderBackend for PwRecordBackend {
    fn start(&self, capture_path: &Path) -> Result<Box<dyn ActiveRecording>, VoiceError> {
        start_pw_record(capture_path)
            .map(|recording| Box::new(recording) as Box<dyn ActiveRecording>)
    }
}

#[derive(Debug)]
pub struct PwRecordChild {
    child: Child,
}

impl ActiveRecording for PwRecordChild {
    fn stop(&mut self) -> Result<(), VoiceError> {
        stop_child(&mut self.child);
        Ok(())
    }
}

impl Drop for PwRecordChild {
    fn drop(&mut self) {
        stop_child(&mut self.child);
    }
}

pub fn pw_record_argv(capture_path: &Path) -> LocalCommandSpec {
    LocalCommandSpec::new(
        "pw-record",
        vec![
            "--rate".to_string(),
            "16000".to_string(),
            "--channels".to_string(),
            "1".to_string(),
            "--format".to_string(),
            "s16".to_string(),
            capture_path.to_string_lossy().into_owned(),
        ],
    )
}

#[cfg(target_os = "linux")]
fn start_pw_record(capture_path: &Path) -> Result<PwRecordChild, VoiceError> {
    if let Some(parent) = capture_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let spec = pw_record_argv(capture_path);
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command.env_clear();
    for (key, value) in crate::process::user_shell_environment() {
        command.env(key, value);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    match command.spawn() {
        Ok(child) => Ok(PwRecordChild { child }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(VoiceError::MissingPwRecord)
        }
        Err(error) => Err(VoiceError::Io(error)),
    }
}

#[cfg(not(target_os = "linux"))]
fn start_pw_record(_capture_path: &Path) -> Result<PwRecordChild, VoiceError> {
    Err(VoiceError::UnsupportedPlatform)
}

fn stop_child(child: &mut Child) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }

    #[cfg(unix)]
    unsafe {
        libc::killpg(child.id() as libc::pid_t, libc::SIGINT);
    }

    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }

    #[cfg(unix)]
    unsafe {
        libc::killpg(child.id() as libc::pid_t, libc::SIGTERM);
    }

    let deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pw_record_argv_records_local_wav() {
        let path = Path::new("/home/dev/.pickforge/voice/s/capture.wav");
        assert_eq!(
            pw_record_argv(path),
            LocalCommandSpec::new(
                "pw-record",
                vec![
                    "--rate".to_string(),
                    "16000".to_string(),
                    "--channels".to_string(),
                    "1".to_string(),
                    "--format".to_string(),
                    "s16".to_string(),
                    path.to_string_lossy().into_owned(),
                ],
            )
        );
    }
}
