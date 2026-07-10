use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::{Duration, Instant};

use super::ssh::{ssh_tunnel_args, SshError, SshTarget};

const OPEN_ATTEMPTS: usize = 3;
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const READY_POLL: Duration = Duration::from_millis(50);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTunnel {
    pub tunnel_id: String,
    pub local_port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTunnelClosed {
    pub tunnel_id: String,
    pub host: String,
    pub local_port: u16,
    pub run_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("remote tunnel port must be non-zero")]
    InvalidRemotePort,
    #[error("failed to reserve a local loopback port: {0}")]
    ReservePort(#[source] std::io::Error),
    #[error("failed to start SSH tunnel: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("SSH tunnel exited before it became ready ({0:?})")]
    ExitedBeforeReady(Option<i32>),
    #[error("SSH tunnel did not become ready within {} seconds", READY_TIMEOUT.as_secs())]
    ReadinessTimeout,
}

type TunnelClosedCallback = Arc<dyn Fn(RemoteTunnelClosed) + Send + Sync + 'static>;
type ReadinessProbe = Arc<
    dyn Fn(u16, &Arc<Mutex<Child>>) -> Result<(), TunnelError> + Send + Sync + 'static,
>;

struct ManagedTunnel {
    run_id: String,
    child: Arc<Mutex<Child>>,
    manually_closed: Arc<AtomicBool>,
}

struct TunnelState {
    entries: Mutex<HashMap<String, ManagedTunnel>>,
    next_id: AtomicU64,
    ssh_program: PathBuf,
    readiness_probe: ReadinessProbe,
}

impl Drop for TunnelState {
    fn drop(&mut self) {
        let entries = self
            .entries
            .get_mut()
            .map(std::mem::take)
            .unwrap_or_default();
        shutdown_entries(entries);
    }
}

#[derive(Clone)]
pub struct TunnelManager {
    state: Arc<TunnelState>,
}

impl Default for TunnelManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TunnelManager {
    pub fn new() -> Self {
        Self::with_parts(PathBuf::from("ssh"), Arc::new(wait_for_ready))
    }

    pub fn open(
        &self,
        host: &str,
        remote_port: u16,
        run_id: impl Into<String>,
        on_closed: impl Fn(RemoteTunnelClosed) + Send + Sync + 'static,
    ) -> Result<RemoteTunnel, TunnelError> {
        if remote_port == 0 {
            return Err(TunnelError::InvalidRemotePort);
        }
        let target = SshTarget::new(host)?;
        let run_id = run_id.into();
        let on_closed: TunnelClosedCallback = Arc::new(on_closed);
        let mut last_error = None;

        for _ in 0..OPEN_ATTEMPTS {
            let local_port = reserve_loopback_port()?;
            let args = ssh_tunnel_args(&target, local_port, remote_port);
            let child = Command::new(&self.state.ssh_program)
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(TunnelError::Spawn)?;
            let child = Arc::new(Mutex::new(child));

            match (self.state.readiness_probe)(local_port, &child) {
                Ok(()) => {
                    let tunnel_id = format!(
                        "remote-tunnel-{}",
                        self.state.next_id.fetch_add(1, Ordering::Relaxed) + 1
                    );
                    let manually_closed = Arc::new(AtomicBool::new(false));
                    self.state
                        .entries
                        .lock()
                        .expect("remote tunnel registry poisoned")
                        .insert(
                            tunnel_id.clone(),
                            ManagedTunnel {
                                run_id: run_id.clone(),
                                child: Arc::clone(&child),
                                manually_closed: Arc::clone(&manually_closed),
                            },
                        );
                    self.watch_child(
                        tunnel_id.clone(),
                        target.host.clone(),
                        local_port,
                        run_id,
                        child,
                        manually_closed,
                        on_closed,
                    );
                    return Ok(RemoteTunnel {
                        tunnel_id,
                        local_port,
                    });
                }
                Err(error) => {
                    terminate_child(&child);
                    last_error = Some(error);
                }
            }
        }

        Err(last_error.expect("remote tunnel attempts must produce an error"))
    }

    pub fn close(&self, tunnel_id: &str) -> bool {
        let entry = self
            .state
            .entries
            .lock()
            .expect("remote tunnel registry poisoned")
            .remove(tunnel_id);
        let Some(entry) = entry else {
            return false;
        };
        entry.manually_closed.store(true, Ordering::Release);
        terminate_child(&entry.child);
        true
    }

    pub fn close_all_for_run(&self, run_id: &str) -> usize {
        let ids = self
            .state
            .entries
            .lock()
            .expect("remote tunnel registry poisoned")
            .iter()
            .filter(|(_, entry)| entry.run_id == run_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let count = ids.len();
        for id in ids {
            self.close(&id);
        }
        count
    }

    pub fn shutdown(&self) {
        let entries = {
            let mut entries = self
                .state
                .entries
                .lock()
                .expect("remote tunnel registry poisoned");
            std::mem::take(&mut *entries)
        };
        shutdown_entries(entries);
    }

    pub fn len(&self) -> usize {
        self.state
            .entries
            .lock()
            .expect("remote tunnel registry poisoned")
            .len()
    }

    fn with_parts(ssh_program: PathBuf, readiness_probe: ReadinessProbe) -> Self {
        Self {
            state: Arc::new(TunnelState {
                entries: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(0),
                ssh_program,
                readiness_probe,
            }),
        }
    }

    fn watch_child(
        &self,
        tunnel_id: String,
        host: String,
        local_port: u16,
        run_id: String,
        child: Arc<Mutex<Child>>,
        manually_closed: Arc<AtomicBool>,
        on_closed: TunnelClosedCallback,
    ) {
        let state = Arc::downgrade(&self.state);
        thread::spawn(move || loop {
            if state.upgrade().is_none() {
                return;
            }
            let status = match child
                .lock()
                .expect("remote tunnel child poisoned")
                .try_wait()
            {
                Ok(status) => status,
                Err(_) => return,
            };
            if let Some(status) = status {
                let Some(state) = Weak::upgrade(&state) else {
                    return;
                };
                let removed = state
                    .entries
                    .lock()
                    .expect("remote tunnel registry poisoned")
                    .remove(&tunnel_id)
                    .is_some();
                if removed && !manually_closed.load(Ordering::Acquire) {
                    on_closed(RemoteTunnelClosed {
                        tunnel_id,
                        host,
                        local_port,
                        run_id,
                        exit_code: status.code(),
                    });
                }
                return;
            }
            thread::sleep(READY_POLL);
        });
    }
}

fn reserve_loopback_port() -> Result<u16, TunnelError> {
    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .map_err(TunnelError::ReservePort)?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(TunnelError::ReservePort)
}

fn wait_for_ready(local_port: u16, child: &Arc<Mutex<Child>>) -> Result<(), TunnelError> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), local_port);
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let exited = child
            .lock()
            .expect("remote tunnel child poisoned")
            .try_wait()
            .map_err(TunnelError::Spawn)?;
        if let Some(status) = exited {
            return Err(TunnelError::ExitedBeforeReady(status.code()));
        }
        if TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(TunnelError::ReadinessTimeout);
        }
        thread::sleep(READY_POLL);
    }
}

fn terminate_child(child: &Arc<Mutex<Child>>) {
    let mut child = child.lock().expect("remote tunnel child poisoned");
    let _ = child.kill();
    let _ = child.wait();
}

fn shutdown_entries(entries: HashMap<String, ManagedTunnel>) {
    for (_, entry) in entries {
        entry.manually_closed.store(true, Ordering::Release);
        terminate_child(&entry.child);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc;

    use super::*;

    #[test]
    fn reserves_a_nonzero_loopback_port() {
        let port = reserve_loopback_port().expect("reserve port");
        assert_ne!(port, 0);
    }

    #[cfg(unix)]
    fn fake_ssh(script: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!(
            "pickforge-fake-ssh-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, script).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn fake_ssh_child_is_closed_and_grouped_by_run() {
        let fake = fake_ssh("#!/bin/sh\nwhile :; do sleep 1; done\n");
        let manager = TunnelManager::with_parts(fake.clone(), Arc::new(|_, _| Ok(())));
        let first = manager
            .open("mac-mini", 8181, "run-1", |_| {})
            .expect("open first tunnel");
        let second = manager
            .open("mac-mini", 8182, "run-2", |_| {})
            .expect("open second tunnel");
        assert_ne!(first.tunnel_id, second.tunnel_id);
        assert_eq!(manager.close_all_for_run("run-1"), 1);
        assert_eq!(manager.len(), 1);
        assert!(manager.close(&second.tunnel_id));
        assert_eq!(manager.len(), 0);
        let _ = fs::remove_file(fake);
    }

    #[cfg(unix)]
    #[test]
    fn child_exit_removes_the_tunnel_and_notifies_once() {
        let fake = fake_ssh("#!/bin/sh\nexit 7\n");
        let manager = TunnelManager::with_parts(fake.clone(), Arc::new(|_, _| Ok(())));
        let (tx, rx) = mpsc::channel();
        let tunnel = manager
            .open("mac-mini", 8181, "run-1", move |closed| tx.send(closed).unwrap())
            .expect("open tunnel");
        let closed = rx.recv_timeout(Duration::from_secs(2)).expect("child exit event");
        assert_eq!(closed.tunnel_id, tunnel.tunnel_id);
        assert_eq!(closed.exit_code, Some(7));
        assert_eq!(manager.len(), 0);
        let _ = fs::remove_file(fake);
    }

    #[cfg(unix)]
    #[test]
    fn readiness_failure_reaps_each_fake_child_before_returning() {
        let fake = fake_ssh("#!/bin/sh\nwhile :; do sleep 1; done\n");
        let manager = TunnelManager::with_parts(
            fake.clone(),
            Arc::new(|_, _| Err(TunnelError::ReadinessTimeout)),
        );
        let error = manager.open("mac-mini", 8181, "run-1", |_| {}).unwrap_err();
        assert!(matches!(error, TunnelError::ReadinessTimeout));
        assert_eq!(manager.len(), 0);
        let _ = fs::remove_file(fake);
    }

    #[cfg(unix)]
    #[test]
    fn dropping_the_manager_kills_open_fake_ssh_children() {
        let marker = std::env::temp_dir().join(format!(
            "pickforge-fake-ssh-pid-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let fake = fake_ssh(&format!(
            "#!/bin/sh\nprintf '%s' \"$$\" > '{}'\nwhile :; do sleep 1; done\n",
            marker.display()
        ));
        let manager = TunnelManager::with_parts(fake.clone(), Arc::new(|_, _| Ok(())));
        manager
            .open("mac-mini", 8181, "run-1", |_| {})
            .expect("open tunnel");

        let deadline = Instant::now() + Duration::from_secs(2);
        while !marker.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        let pid = fs::read_to_string(&marker)
            .expect("fake ssh wrote pid")
            .parse::<libc::pid_t>()
            .expect("valid fake ssh pid");

        drop(manager);

        let deadline = Instant::now() + Duration::from_secs(2);
        while process_exists(pid) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!process_exists(pid), "fake ssh child survived manager drop");
        let _ = fs::remove_file(marker);
        let _ = fs::remove_file(fake);
    }

    #[cfg(unix)]
    fn process_exists(pid: libc::pid_t) -> bool {
        let result = unsafe { libc::kill(pid, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}
