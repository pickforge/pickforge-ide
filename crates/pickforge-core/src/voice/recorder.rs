#![cfg_attr(not(target_os = "linux"), allow(dead_code))] // TODO(#263): split Linux-only voice implementation.

use std::collections::HashMap;
use std::path::Path;
use std::process::Child;
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use super::create_private_dir_all;
use super::{LocalCommandSpec, VoiceError};

const FAST_FAIL_WINDOW: Duration = Duration::from_millis(200);

pub trait ActiveRecording: Send {
    fn stop(&mut self) -> Result<(), VoiceError>;
}

pub trait RecorderBackend: Send + Sync + 'static {
    fn start(
        &self,
        capture_path: &Path,
        cancelled: &AtomicBool,
    ) -> Result<Box<dyn ActiveRecording>, VoiceError>;
}

#[derive(Debug, Clone, Default)]
pub struct PwRecordBackend {
    env: Option<HashMap<String, String>>,
}

impl PwRecordBackend {
    #[cfg(test)]
    pub fn with_env(env: HashMap<String, String>) -> Self {
        Self { env: Some(env) }
    }
}

impl RecorderBackend for PwRecordBackend {
    fn start(
        &self,
        capture_path: &Path,
        cancelled: &AtomicBool,
    ) -> Result<Box<dyn ActiveRecording>, VoiceError> {
        start_pw_record(capture_path, self.env.as_ref(), cancelled)
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
fn start_pw_record(
    capture_path: &Path,
    env_override: Option<&HashMap<String, String>>,
    cancelled: &AtomicBool,
) -> Result<PwRecordChild, VoiceError> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(VoiceError::ShuttingDown);
    }
    if let Some(parent) = capture_path.parent() {
        create_private_dir_all(parent)?;
    }

    let spec = pw_record_argv(capture_path);
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.env_clear();
    let env = env_override.cloned().unwrap_or_else(|| {
        crate::process::user_shell_environment()
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    });
    for (key, value) in env {
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

    match command.spawn() {
        Ok(mut child) => {
            // Crash containment: no-op unless the guardian/job is active.
            crate::process::contain_owned_root(child.id());
            match wait_for_immediate_exit(&mut child, cancelled)? {
                true => Err(VoiceError::RecorderExited),
                false => Ok(PwRecordChild { child }),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(VoiceError::MissingPwRecord)
        }
        Err(error) => Err(VoiceError::Io(error)),
    }
}

#[cfg(not(target_os = "linux"))]
fn start_pw_record(
    _capture_path: &Path,
    _env_override: Option<&HashMap<String, String>>,
    _cancelled: &AtomicBool,
) -> Result<PwRecordChild, VoiceError> {
    Err(VoiceError::UnsupportedPlatform)
}

fn wait_for_immediate_exit(child: &mut Child, cancelled: &AtomicBool) -> Result<bool, VoiceError> {
    let deadline = Instant::now() + FAST_FAIL_WINDOW;
    while Instant::now() < deadline {
        if cancelled.load(Ordering::SeqCst) {
            stop_child(child);
            return Err(VoiceError::ShuttingDown);
        }
        if child.try_wait()?.is_some() {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(20));
    }
    Ok(false)
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
    #[cfg(target_os = "linux")]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(target_os = "linux")]
    use std::time::SystemTime;

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

    #[cfg(target_os = "linux")]
    #[test]
    fn pw_record_fast_fails_when_child_exits_immediately() {
        let dir = std::env::temp_dir().join(format!(
            "pf-voice-fast-fail-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bin_dir = dir.join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let script = bin_dir.join("pw-record");
        std::fs::write(&script, b"#!/bin/sh\nexit 7\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        let mut env = HashMap::new();
        env.insert("PATH".to_string(), bin_dir.to_string_lossy().into_owned());
        let backend = PwRecordBackend::with_env(env);
        let result = backend.start(&dir.join("capture.wav"), &AtomicBool::new(false));

        assert!(matches!(result, Err(VoiceError::RecorderExited)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
