use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use rand::RngCore;
use serde::Serialize;

use super::{shell_quote_argv, ssh_one_shot_args, SshTarget};
use crate::process::run_timeout;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
const LEASE_TTL_SECS: u64 = 45;
const CONTROL_SSH_TIMEOUT: Duration = Duration::from_secs(8);
const BOOTSTRAP_READY: &str = "__PF_REMOTE_LEASE_READY_V1__";
const BOOTSTRAP_READY_TIMEOUT: Duration = Duration::from_secs(15);
const SUPERVISOR_FILE: &str = "supervisor-v1.py";

/// A local, in-memory capability for exactly one remote process lease.
///
/// Dropping the handle stops its heartbeat and asks the authenticated supervisor
/// to tear down only that lease's payload process group.
pub struct RemoteLeaseHandle {
    inner: Arc<LeaseInner>,
    heartbeat: Mutex<Option<JoinHandle<()>>>,
    finalized: AtomicBool,
    payload: Mutex<Option<Vec<u8>>>,
    bootstrap: Mutex<Option<Bootstrap>>,
}

struct LeaseInner {
    target: SshTarget,
    lease_id: String,
    nonce: String,
    stopped: Mutex<bool>,
    wake: Condvar,
}

struct Bootstrap {
    child: Child,
    writer: JoinHandle<()>,
}

#[derive(Serialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
#[allow(clippy::enum_variant_names)] // TODO(#263): simplify legacy interface.
pub(crate) enum RemoteLeasePayload {
    LoginShell { cwd: String },
    LoginCommand { cwd: String, command: String },
    LoginArgv { cwd: String, argv: Vec<String> },
}

/// The sole feature-flag seam for remote process launches. Disabled launches
/// return the original direct SSH command byte-for-byte; enabled launches wrap
/// the structured payload and return its in-memory lease capability.
pub(crate) fn remote_process_command(
    target: &SshTarget,
    enabled: bool,
    payload: RemoteLeasePayload,
    direct_command: String,
) -> (String, Option<RemoteLeaseHandle>) {
    if !enabled {
        return (direct_command, None);
    }
    let payload = serde_json::to_vec(&payload).expect("remote lease payload serializes");
    let handle = RemoteLeaseHandle::new(target.clone(), payload);
    let command = handle.launch_command();
    (command, Some(handle))
}

impl RemoteLeaseHandle {
    pub(crate) fn new(target: SshTarget, payload: Vec<u8>) -> Self {
        Self {
            inner: Arc::new(LeaseInner {
                target,
                lease_id: random_hex(),
                nonce: random_hex(),
                stopped: Mutex::new(false),
                wake: Condvar::new(),
            }),
            heartbeat: Mutex::new(None),
            finalized: AtomicBool::new(false),
            payload: Mutex::new(Some(payload)),
            bootstrap: Mutex::new(None),
        }
    }

    pub(crate) fn launch_command(&self) -> String {
        build_launch_command(&self.inner.lease_id, &self.inner.nonce)
    }

    /// Start the short-lived bootstrap SSH. The sensitive structured payload is
    /// carried only on stdin and held in memory by the remote setup helper until
    /// the supervisor opens its private FIFO; it never appears in process argv.
    pub(crate) fn prepare(&self) -> std::io::Result<()> {
        let payload = self
            .payload
            .lock()
            .expect("remote lease payload poisoned")
            .take()
            .unwrap_or_default();
        let command = build_bootstrap_command(&self.inner.lease_id);
        let mut child = Command::new("ssh")
            .args(control_ssh_args(&self.inner.target, command))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::other("bootstrap ssh stdin unavailable"));
        };
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::other("bootstrap ssh stdout unavailable"));
        };
        let writer = match std::thread::Builder::new()
            .name(format!("remote-bootstrap-{}", &self.inner.lease_id[..8]))
            .spawn(move || {
                let _ = stdin.write_all(&payload);
            })
        {
            Ok(writer) => writer,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let ready_reader = match std::thread::Builder::new()
            .name("remote-bootstrap-ready".to_string())
            .spawn(move || {
                let mut line = String::new();
                let result = BufReader::new(stdout)
                    .read_line(&mut line)
                    .map(|_| line);
                let _ = ready_tx.send(result);
            })
        {
            Ok(reader) => reader,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = writer.join();
                return Err(error);
            }
        };
        match ready_rx.recv_timeout(BOOTSTRAP_READY_TIMEOUT) {
            Ok(Ok(line)) if line.trim() == BOOTSTRAP_READY => {}
            result => {
                let status = match child.try_wait() {
                    Ok(status) => status.or_else(|| {
                        let _ = child.kill();
                        child.wait().ok()
                    }),
                    Err(error) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = writer.join();
                        let _ = ready_reader.join();
                        return Err(error);
                    }
                };
                let _ = writer.join();
                let _ = ready_reader.join();
                if status.and_then(|status| status.code()) == Some(127) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "PickForge remote leases require Python 3",
                    ));
                }
                return Err(std::io::Error::other(format!(
                    "remote lease bootstrap did not become ready: {result:?}"
                )));
            }
        }
        let _ = ready_reader.join();
        *self.bootstrap.lock().expect("remote bootstrap poisoned") =
            Some(Bootstrap { child, writer });
        Ok(())
    }

    /// Begin extending the lease. This is deliberately separate from construction:
    /// callers activate only after the local ssh child has spawned successfully.
    pub(crate) fn start_heartbeat(&self) -> std::io::Result<()> {
        let mut slot = self.heartbeat.lock().expect("remote lease heartbeat poisoned");
        if slot.is_some() || self.finalized.load(Ordering::SeqCst) {
            return Ok(());
        }
        let inner = Arc::clone(&self.inner);
        match std::thread::Builder::new()
            .name(format!("remote-lease-{}", &inner.lease_id[..8]))
            .spawn(move || heartbeat_loop(inner))
        {
            Ok(thread) => {
                *slot = Some(thread);
                Ok(())
            }
            Err(error) => {
                drop(slot);
                self.stop();
                Err(error)
            }
        }
    }

    pub(crate) fn finish_natural(&self) {
        if self.finalized.swap(true, Ordering::SeqCst) {
            return;
        }
        self.request_heartbeat_stop();
        self.finish_background_work();
    }

    pub(crate) fn stop(&self) {
        if self.finalized.swap(true, Ordering::SeqCst) {
            return;
        }
        self.request_heartbeat_stop();
        let inner = Arc::clone(&self.inner);
        let _ = std::thread::Builder::new()
            .name("remote-lease-control-stop".to_string())
            .spawn(move || run_control(&inner, "stop"));
        let heartbeat = self.heartbeat.lock().ok().and_then(|mut slot| slot.take());
        let bootstrap = self.bootstrap.lock().ok().and_then(|mut slot| slot.take());
        let _ = std::thread::Builder::new()
            .name("remote-lease-local-reaper".to_string())
            .spawn(move || {
                if let Some(thread) = heartbeat {
                    let _ = thread.join();
                }
                finish_bootstrap(bootstrap);
            });
    }

    pub(crate) fn stop_bounded(&self) {
        if self.finalized.swap(true, Ordering::SeqCst) {
            return;
        }
        self.request_heartbeat_stop();
        run_control(&self.inner, "stop");
        self.finish_background_work();
    }

    fn request_heartbeat_stop(&self) {
        let mut stopped = self.inner.stopped.lock().expect("remote lease stop poisoned");
        *stopped = true;
        self.inner.wake.notify_all();
    }

    fn finish_background_work(&self) {
        if let Ok(mut slot) = self.heartbeat.lock() {
            if let Some(thread) = slot.take() {
                let _ = thread.join();
            }
        }
        let bootstrap = self.bootstrap.lock().ok().and_then(|mut slot| slot.take());
        finish_bootstrap(bootstrap);
    }

    #[cfg(test)]
    fn lease_id(&self) -> &str {
        &self.inner.lease_id
    }
}

fn finish_bootstrap(bootstrap: Option<Bootstrap>) {
    if let Some(mut bootstrap) = bootstrap {
        let _ = bootstrap.child.kill();
        let _ = bootstrap.child.wait();
        let _ = bootstrap.writer.join();
    }
}

impl Drop for RemoteLeaseHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

fn spawn_or_stop_lease(
    lease: Arc<RemoteLeaseHandle>,
    spawn: impl FnOnce(Arc<RemoteLeaseHandle>) -> std::io::Result<JoinHandle<()>>,
) -> Option<JoinHandle<()>> {
    let worker = Arc::clone(&lease);
    match spawn(worker) {
        Ok(thread) => Some(thread),
        Err(_) => {
            lease.stop_bounded();
            None
        }
    }
}

pub(crate) fn stop_remote_leases_bounded(leases: Vec<RemoteLeaseHandle>) {
    let mut threads = Vec::with_capacity(leases.len());
    for lease in leases {
        let lease = Arc::new(lease);
        if let Some(thread) = spawn_or_stop_lease(lease, |worker| {
            std::thread::Builder::new()
                .name("remote-lease-stop".to_string())
                .spawn(move || worker.stop_bounded())
        }) {
            threads.push(Some(thread));
        }
    }
    let deadline = std::time::Instant::now() + CONTROL_SSH_TIMEOUT * 2 + Duration::from_secs(1);
    while threads.iter().any(Option::is_some) && std::time::Instant::now() < deadline {
        for thread in &mut threads {
            if thread.as_ref().is_some_and(|thread| thread.is_finished()) {
                let _ = thread.take().expect("finished remote stop thread").join();
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }

}

fn heartbeat_loop(inner: Arc<LeaseInner>) {
    loop {
        let stopped = inner.stopped.lock().expect("remote lease stop poisoned");
        let (stopped, wait) = inner
            .wake
            .wait_timeout_while(stopped, HEARTBEAT_INTERVAL, |stopped| !*stopped)
            .expect("remote lease stop poisoned");
        if *stopped {
            break;
        }
        if wait.timed_out() {
            drop(stopped);
            run_control(&inner, "beat");
        }
    }
}

fn control_ssh_args(target: &SshTarget, command: String) -> Vec<String> {
    let mut args = ssh_one_shot_args(target, command);
    let separator = args
        .iter()
        .position(|arg| arg == "--")
        .expect("one-shot ssh args include separator");
    args.splice(
        separator..separator,
        [
            "-o".to_string(),
            "ServerAliveInterval=2".to_string(),
            "-o".to_string(),
            "ServerAliveCountMax=2".to_string(),
        ],
    );
    args
}

fn run_control(inner: &LeaseInner, action: &str) {
    let command = build_control_command(action, &inner.lease_id, &inner.nonce);
    let args = control_ssh_args(&inner.target, command);
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let _ = run_timeout("ssh", &refs, None, None, CONTROL_SSH_TIMEOUT);
}

fn random_hex() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex_encode(&bytes)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn runtime_prelude() -> String {
    format!(
        "pf_uid=\"${{UID:-$(id -u)}}\"; if test -n \"${{XDG_RUNTIME_DIR:-}}\"; then pf_root=\"$XDG_RUNTIME_DIR\"; pf_kind=xdg; pf_base=\"$pf_root/pickforge/remote-leases/v1\"; else pf_root=\"/tmp/pickforge-$pf_uid\"; pf_kind=fallback; pf_base=\"$pf_root/remote-leases/v1\"; fi; pf_script=\"$pf_base/{SUPERVISOR_FILE}\""
    )
}

const PATH_LOADER: &str = r#"import os,stat,sys
root,kind,script,action,lease_id,nonce,ttl=sys.argv[1:]
uid=os.getuid()
def secure_dir(path):
 st=os.lstat(path)
 return stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_uid==uid and stat.S_IMODE(st.st_mode)==0o700
if not os.path.isabs(root) or kind not in ("xdg","fallback"):
 raise SystemExit(126)
if kind=="fallback" and root!="/tmp/pickforge-"+str(uid):
 raise SystemExit(126)
parts=[root]
if kind=="xdg": parts += [os.path.join(root,"pickforge")]
parts += [os.path.join(parts[-1],"remote-leases"),os.path.join(parts[-1],"remote-leases","v1")]
try:
 if not all(secure_dir(path) for path in parts):
  if action=="supervise": print("PickForge remote lease bootstrap is unavailable",file=sys.stderr)
  raise SystemExit(126)
 st=os.lstat(script)
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=uid or stat.S_IMODE(st.st_mode)!=0o700: raise SystemExit(126)
except FileNotFoundError:
 if action=="supervise": print("PickForge remote lease bootstrap is unavailable",file=sys.stderr)
 raise SystemExit(0 if action!="supervise" else 126)
os.execv(sys.executable,[sys.executable,script,action,lease_id,nonce,ttl])"#;

const BOOTSTRAP_INSTALLER: &str = r#"import atexit,errno,os,signal,stat,sys,time
root,kind,script,script_hex,lease_id=sys.argv[1:]
uid=os.getuid()
def secure(path):
 st=os.lstat(path)
 if not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=uid or stat.S_IMODE(st.st_mode)!=0o700: raise SystemExit(126)
def make(path):
 try: os.mkdir(path,0o700)
 except FileExistsError: pass
 secure(path)
if not os.path.isabs(root) or kind not in ("xdg","fallback"): raise SystemExit(126)
if kind=="xdg":
 secure(root)
 base=os.path.join(root,"pickforge")
 make(base)
else:
 if root!="/tmp/pickforge-"+str(uid): raise SystemExit(126)
 make(root)
 base=root
base=os.path.join(base,"remote-leases"); make(base)
base=os.path.join(base,"v1"); make(base)
if script!=os.path.join(base,"supervisor-v1.py"): raise SystemExit(126)
try:
 st=os.lstat(script)
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_uid!=uid or stat.S_IMODE(st.st_mode)!=0o700: raise SystemExit(126)
except FileNotFoundError: pass
data=bytes.fromhex(script_hex)
tmp=script+".tmp-"+str(os.getpid())
fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700)
with os.fdopen(fd,"wb") as out: out.write(data)
os.replace(tmp,script)
lease=os.path.join(base,lease_id)
os.mkdir(lease,0o700); secure(lease)
fifo=os.path.join(lease,"bootstrap")
os.mkfifo(fifo,0o600)
armed=[True]
def rollback():
 if not armed[0]: return
 try: os.unlink(fifo)
 except FileNotFoundError: pass
 try: os.rmdir(lease)
 except OSError: pass
atexit.register(rollback)
def interrupted(_signum,_frame): raise SystemExit(143)
for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT): signal.signal(sig,interrupted)
payload=sys.stdin.buffer.read(16*1024*1024+1)
if len(payload)>16*1024*1024: raise SystemExit(126)
print("__PF_REMOTE_LEASE_READY_V1__",flush=True)
deadline=time.monotonic()+30.0
while True:
 try:
  writer=os.open(fifo,os.O_WRONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
  break
 except OSError as error:
  if error.errno!=errno.ENXIO or time.monotonic()>=deadline: raise SystemExit(124)
  time.sleep(0.05)
with os.fdopen(writer,"wb",buffering=0) as target: target.write(payload)
armed[0]=False"#;

fn build_bootstrap_command(lease_id: &str) -> String {
    let script_hex = hex_encode(SUPERVISOR.as_bytes());
    let missing = shell_quote_argv(&["PickForge remote leases require Python 3"]);
    format!(
        "{}; command -v python3 >/dev/null 2>&1 || {{ printf '%s\\n' {} >&2; exit 127; }}; exec python3 -c {} \"$pf_root\" \"$pf_kind\" \"$pf_script\" {} {}",
        runtime_prelude(),
        missing,
        shell_quote_argv(&[BOOTSTRAP_INSTALLER]),
        shell_quote_argv(&[&script_hex]),
        shell_quote_argv(&[lease_id]),
    )
}

fn build_launch_command(lease_id: &str, nonce: &str) -> String {
    format!(
        "{}; command -v python3 >/dev/null 2>&1 || exit 127; exec python3 -c {} \"$pf_root\" \"$pf_kind\" \"$pf_script\" supervise {} {} {}",
        runtime_prelude(),
        shell_quote_argv(&[PATH_LOADER]),
        shell_quote_argv(&[lease_id]),
        shell_quote_argv(&[nonce]),
        LEASE_TTL_SECS,
    )
}

fn build_control_command(action: &str, lease_id: &str, nonce: &str) -> String {
    format!(
        "{}; command -v python3 >/dev/null 2>&1 || exit 127; exec python3 -c {} \"$pf_root\" \"$pf_kind\" \"$pf_script\" {} {} {} {}",
        runtime_prelude(),
        shell_quote_argv(&[PATH_LOADER]),
        shell_quote_argv(&[action]),
        shell_quote_argv(&[lease_id]),
        shell_quote_argv(&[nonce]),
        LEASE_TTL_SECS,
    )
}

const SUPERVISOR: &str = r#"#!/usr/bin/env python3
import errno
import fcntl
import json
import os
import platform
import re
import select
import shlex
import signal
import subprocess
import stat
import sys
import time

PROTOCOL = "pickforge-remote-lease-v1"
VALID = re.compile(r"^[0-9a-f]{32}$")
GRACE = 1.0
POLL = 0.10


def fail(message, code=1):
    print("pickforge remote lease: " + message, file=sys.stderr)
    raise SystemExit(code)

def read_bootstrap(fifo):
    fd=os.open(fifo,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    deadline=time.monotonic()+30.0
    data=bytearray()
    saw_data=False
    try:
        while time.monotonic()<deadline:
            remaining=max(0.0,deadline-time.monotonic())
            if remaining==0.0: break
            ready,_,_=select.select([fd],[],[],min(0.1,remaining))
            if not ready: continue
            chunk=os.read(fd,65536)
            if chunk:
                saw_data=True
                data.extend(chunk)
                if len(data)>16*1024*1024: fail("bootstrap payload too large",126)
            elif saw_data:
                return bytes(data)
            else:
                time.sleep(0.02)
        fail("bootstrap payload timed out",124)
    finally:
        os.close(fd)


def paths(lease_id):
    base = os.path.dirname(os.path.abspath(__file__))
    lease = os.path.join(base, lease_id)
    return lease, os.path.join(lease, "state.json"), os.path.join(lease, "state.lock"), os.path.join(lease, "live.lock")

def secure_dir(path):
    st=os.lstat(path)
    return stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700


def validate_runtime(lease):
    base=os.path.dirname(lease)
    remote_leases=os.path.dirname(base)
    private_root=os.path.dirname(remote_leases)
    required=[base,remote_leases,private_root,lease]
    if os.path.basename(private_root)=="pickforge":
        required.append(os.path.dirname(private_root))
    if not all(secure_dir(path) for path in required):
        fail("insecure remote lease runtime",126)


def proc_start(pid):
    try:
        raw = open("/proc/%d/stat" % pid, "r", encoding="ascii").read()
        return raw[raw.rfind(")") + 2:].split()[19]
    except (OSError, IndexError):
        return None


def process_identity(pid):
    system = platform.system()
    if system == "Linux":
        start = proc_start(pid)
        return None if start is None else {"kind": "linux-proc-start-v1", "start": start}
    if system in ("Darwin", "FreeBSD", "OpenBSD", "NetBSD"):
        try:
            result = subprocess.run(
                ["ps", "-o", "lstart=", "-p", str(pid)],
                check=False, capture_output=True, text=True, timeout=1.0,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        start = result.stdout.strip()
        return None if result.returncode != 0 or not start else {"kind": "bsd-lstart-v1", "start": start}
    return None


def identity_matches(pid, identity):
    return isinstance(identity, dict) and process_identity(pid) == identity


def identity_for_self():
    identity = process_identity(os.getpid())
    if identity is None:
        fail("unsupported remote process identity", 126)
    identity["helper_argv"] = "supervise-id-nonce-ttl"
    return identity


def lock_file(path):
    fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    st=os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or stat.S_IMODE(st.st_mode)!=0o600:
        os.close(fd)
        fail("insecure remote lease state",126)
    return os.fdopen(fd,"r+",encoding="utf-8")


def read_state(path):
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,"r",encoding="utf-8") as source:
            return json.load(source)
    except (OSError,ValueError):
        return None


def helper_argv_matches(pid,lease_id,nonce):
    if platform.system()=="Linux":
        return True
    try:
        result=subprocess.run(
            ["ps","-o","command=","-p",str(pid)],
            check=False,capture_output=True,text=True,timeout=1.0,
        )
        argv=shlex.split(result.stdout.strip())
        return result.returncode==0 and len(argv)>=6 and argv[-4]=="supervise" and argv[-3]==lease_id and argv[-2]==nonce
    except (OSError,ValueError,subprocess.SubprocessError):
        return False


def write_state(path, state):
    tmp = path + ".tmp-" + str(os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(state, target, separators=(",", ":"), sort_keys=True)
            target.flush()
            os.fsync(target.fileno())
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def state_matches(state, lease_id, nonce, require_running=False):
    if not isinstance(state, dict):
        return False
    if state.get("protocol") != PROTOCOL or state.get("lease_id") != lease_id or state.get("nonce") != nonce:
        return False
    if require_running and state.get("state") != "running":
        return False
    identity = state.get("supervisor_identity")
    pid = state.get("supervisor_pid")
    if not isinstance(pid, int) or not isinstance(identity, dict):
        return False
    if identity.get("helper_argv") != "supervise-id-nonce-ttl":
        return False
    current = process_identity(pid)
    return (
        current is not None
        and current.get("kind") == identity.get("kind")
        and current.get("start") == identity.get("start")
        and helper_argv_matches(pid,lease_id,nonce)
    )

def local_state_matches(state,lease_id,nonce,pid,identity):
    return (
        isinstance(state,dict)
        and state.get("protocol")==PROTOCOL
        and state.get("lease_id")==lease_id
        and state.get("nonce")==nonce
        and state.get("supervisor_pid")==pid
        and state.get("supervisor_identity")==identity
    )


def live_lock_held(path):
    try:
        probe = lock_file(path)
    except OSError:
        return False
    try:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        return False
    finally:
        probe.close()


def control(action, lease_id, nonce, ttl):
    if not VALID.fullmatch(lease_id) or not VALID.fullmatch(nonce):
        return 0
    lease, state_path, state_lock_path, live_lock_path = paths(lease_id)
    try:
        state_lock = lock_file(state_lock_path)
    except OSError:
        return 0
    with state_lock:
        fcntl.flock(state_lock, fcntl.LOCK_EX)
        state = read_state(state_path)
        if not state_matches(state, lease_id, nonce) or not live_lock_held(live_lock_path):
            return 0
        if action == "beat":
            if state.get("state") != "running":
                return 0
            state["expiry"] = time.time() + ttl
        elif action == "stop":
            if state.get("state") not in ("starting", "running"):
                return 0
            state["state"] = "stopping"
        else:
            return 2
        write_state(state_path, state)
    if action == "stop":
        deadline = time.monotonic() + GRACE + 3.0
        while time.monotonic() < deadline and os.path.exists(state_path):
            time.sleep(POLL)
    return 0


def payload_alive(pid):
    try:
        waited, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return False, 0
    return (True, None) if waited == 0 else (False, status)


def valid_payload_group(pid, pgid, identity, session_id):
    if not isinstance(pid, int) or not isinstance(pgid, int) or pid <= 0 or pgid <= 0 or pid != pgid:
        return False
    try:
        return (
            identity_matches(pid, identity)
            and os.getpgid(pid) == pgid
            and os.getsid(pid) == session_id
        )
    except ProcessLookupError:
        return False

def establish_payload_group(pid):
    try:
        os.setpgid(pid,pid)
        return True
    except OSError as error:
        if error.errno==errno.EACCES:
            try:
                return os.getpgid(pid)==pid
            except ProcessLookupError:
                return False
        if error.errno==errno.ESRCH:
            return False
        raise


def foreground_group(session_id, payload_pgid):
    if not os.isatty(0):
        return None
    try:
        pgid=os.tcgetpgrp(0)
        identity=process_identity(pgid)
        if pgid<=0 or pgid==payload_pgid or identity is None:
            return None
        if os.getpgid(pgid)!=pgid or os.getsid(pgid)!=session_id:
            return None
        return (pgid,identity)
    except (OSError,ProcessLookupError):
        return None


def signal_group(pgid, identity, session_id, sig):
    if not valid_payload_group(pgid,pgid,identity,session_id):
        return False
    try:
        os.killpg(pgid,sig)
        return True
    except ProcessLookupError:
        return False


def reclaim_terminal():
    if os.isatty(0):
        try:
            os.tcsetpgrp(0, os.getpgrp())
        except OSError:
            pass


def terminate_payload(pid, pgid, identity, session_id, can_wait=True, include_foreground=True):
    status=None
    if can_wait:
        alive,status=payload_alive(pid)
        if not alive:
            return status
    if not valid_payload_group(pid,pgid,identity,session_id):
        return None
    foreground=foreground_group(session_id,pgid) if include_foreground else None
    reclaim_terminal()
    groups=[(pgid,identity)]
    if foreground is not None:
        groups.append(foreground)
    for group, birth in groups:
        signal_group(group,birth,session_id,signal.SIGTERM)
    deadline=time.monotonic()+GRACE
    while time.monotonic()<deadline:
        if can_wait:
            alive,status=payload_alive(pid)
        if not any(valid_payload_group(group,group,birth,session_id) for group,birth in groups):
            return status
        time.sleep(POLL)
    for group,birth in groups:
        signal_group(group,birth,session_id,signal.SIGKILL)
    if can_wait:
        try:
            return os.waitpid(pid,0)[1]
        except ChildProcessError:
            return status
    return status

def watchdog(lease_id, nonce, pid, pgid, identity, session_id):
    try:
        os.setsid()
    except OSError:
        pass
    for sig in (signal.SIGHUP,signal.SIGTERM,signal.SIGINT,signal.SIGQUIT,signal.SIGWINCH):
        signal.signal(sig,signal.SIG_IGN)
    devnull=os.open("/dev/null",os.O_RDWR)
    for fd in (0,1,2):
        try: os.dup2(devnull,fd)
        except OSError: pass
    if devnull>2: os.close(devnull)
    lease,state_path,state_lock_path,_live_lock_path=paths(lease_id)
    try:
        state_lock=lock_file(state_lock_path)
    except OSError:
        return
    while True:
        fcntl.flock(state_lock,fcntl.LOCK_EX)
        state=read_state(state_path)
        if state is None:
            fcntl.flock(state_lock,fcntl.LOCK_UN)
            return
        owned=(
            state.get("protocol")==PROTOCOL
            and state.get("lease_id")==lease_id
            and state.get("nonce")==nonce
            and state.get("payload_pid")==pid
            and state.get("payload_pgid")==pgid
            and state.get("payload_identity")==identity
        )
        expired=state.get("state")!="running" or state.get("expiry",0)<=time.time()
        if owned and expired and state.get("state")=="running":
            state["state"]="stopping"
            write_state(state_path,state)
        fcntl.flock(state_lock,fcntl.LOCK_UN)
        if not owned:
            return
        if expired:
            terminate_payload(pid,pgid,identity,session_id,can_wait=False,include_foreground=False)
            cleanup(lease,state_path)
            return
        time.sleep(POLL)


def cleanup(lease, state_path):
    for name in ("bootstrap", "state.json", "state.lock", "live.lock"):
        try:
            os.unlink(os.path.join(lease, name))
        except FileNotFoundError:
            pass
    try:
        os.rmdir(lease)
    except OSError:
        pass


def exit_code(status):
    if status is None:
        return 1
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def supervise(lease_id, nonce, ttl):
    if not VALID.fullmatch(lease_id) or not VALID.fullmatch(nonce):
        fail("invalid lease identity", 126)
    lease, state_path, state_lock_path, live_lock_path = paths(lease_id)
    validate_runtime(lease)
    fifo = os.path.join(lease, "bootstrap")
    live_lock = lock_file(live_lock_path)
    fcntl.flock(live_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        encoded = read_bootstrap(fifo)
        os.unlink(fifo)
        payload = json.loads(encoded.decode("utf-8"))
        identity = identity_for_self()
        mode = payload.get("mode")
        cwd = payload.get("cwd")
        if not isinstance(cwd, str) or not cwd.startswith("/") or "\x00" in cwd:
            fail("invalid payload working directory", 126)
        shell = os.environ.get("SHELL") or "/bin/sh"
        if mode == "login_shell":
            argv = [shell, "-l"]
        elif mode == "login_command" and isinstance(payload.get("command"), str):
            argv = [shell, "-lc", payload["command"]]
        elif mode == "login_argv" and isinstance(payload.get("argv"), list) and payload["argv"] and all(isinstance(v, str) and "\x00" not in v for v in payload["argv"]):
            argv = [shell, "-lc", shlex.join(payload["argv"])]
        else:
            fail("invalid bootstrap payload", 126)
    except (ValueError, UnicodeDecodeError, OSError, SystemExit):
        cleanup(lease, state_path)
        live_lock.close()
        raise
    try:
        os.setpgid(0, 0)
    except OSError as error:
        if error.errno not in (errno.EPERM, errno.EACCES):
            cleanup(lease, state_path)
            live_lock.close()
            raise
    stop_requested = [False]
    payload_ref = [None, None, None, None]
    def on_stop(_signum, _frame):
        stop_requested[0] = True
    def on_winch(_signum, _frame):
        pid, pgid, birth, session_id = payload_ref
        if valid_payload_group(pid, pgid, birth, session_id):
            try:
                os.killpg(pgid, signal.SIGWINCH)
            except ProcessLookupError:
                pass
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT, signal.SIGQUIT):
        signal.signal(sig, on_stop)
    signal.signal(signal.SIGWINCH, on_winch)
    state = {
        "protocol": PROTOCOL,
        "lease_id": lease_id,
        "supervisor_pid": os.getpid(),
        "nonce": nonce,
        "supervisor_identity": identity,
        "payload_pid": None,
        "payload_pgid": None,
        "payload_identity": None,
        "state": "starting",
        "expiry": time.time() + ttl,
    }
    state_lock = lock_file(state_lock_path)
    fcntl.flock(state_lock, fcntl.LOCK_EX)
    write_state(state_path, state)
    fcntl.flock(state_lock, fcntl.LOCK_UN)

    # Keep the state lock across the stop check, fork, and running record.
    # Stop therefore either prevents launch or sees the complete payload identity.
    fcntl.flock(state_lock, fcntl.LOCK_EX)
    current = read_state(state_path)
    if stop_requested[0] or not local_state_matches(current,lease_id,nonce,os.getpid(),identity) or current.get("state") != "starting":
        fcntl.flock(state_lock, fcntl.LOCK_UN)
        cleanup(lease, state_path)
        live_lock.close()
        return 143
    pid = os.fork()
    if pid == 0:
        try:
            os.setpgid(0, 0)
            os.chdir(cwd)
            os.execvpe(argv[0], argv, os.environ.copy())
        except BaseException as error:
            print("pickforge remote lease: payload launch failed: " + str(error), file=sys.stderr)
            os._exit(126)
    if not establish_payload_group(pid):
        try: os.kill(pid,signal.SIGKILL)
        except ProcessLookupError: pass
        try: os.waitpid(pid,0)
        except ChildProcessError: pass
        fcntl.flock(state_lock,fcntl.LOCK_UN)
        cleanup(lease,state_path)
        live_lock.close()
        return 126
    pgid = pid
    birth = process_identity(pid)
    session_id = os.getsid(pid)
    if birth is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        fcntl.flock(state_lock, fcntl.LOCK_UN)
        cleanup(lease, state_path)
        live_lock.close()
        return 126
    payload_ref[:] = [pid, pgid, birth, session_id]
    current["payload_pid"] = pid
    current["payload_pgid"] = pgid
    current["payload_identity"] = birth
    current["state"] = "running"
    write_state(state_path, current)
    fcntl.flock(state_lock, fcntl.LOCK_UN)
    if os.isatty(0):
        try:
            os.tcsetpgrp(0, pgid)
        except OSError:
            pass
    watchdog_pid = os.fork()
    if watchdog_pid == 0:
        state_lock.close()
        live_lock.close()
        watchdog(lease_id, nonce, pid, pgid, birth, session_id)
        os._exit(0)
    status = None
    try:
        while True:
            alive, status = payload_alive(pid)
            if not alive:
                break
            fcntl.flock(state_lock, fcntl.LOCK_EX)
            current = read_state(state_path)
            if not local_state_matches(current,lease_id,nonce,os.getpid(),identity):
                stop_requested[0] = True
            elif current.get("state") != "running" or current.get("expiry", 0) <= time.time():
                if current.get("state") == "running":
                    current["state"] = "stopping"
                    write_state(state_path, current)
                stop_requested[0] = True
            fcntl.flock(state_lock, fcntl.LOCK_UN)
            if stop_requested[0]:
                status = terminate_payload(pid, pgid, birth, session_id)
                break
            time.sleep(POLL)
    finally:
        reclaim_terminal()
        cleanup(lease, state_path)
        live_lock.close()
        try:
            os.waitpid(watchdog_pid, 0)
        except ChildProcessError:
            pass
    return exit_code(status)


def main():
    if len(sys.argv) != 5:
        fail("invalid helper invocation", 126)
    action, lease_id, nonce = sys.argv[1:4]
    try:
        ttl = float(sys.argv[4])
    except ValueError:
        fail("invalid lease ttl", 126)
    # Keep a fixed argv shape: script, action, opaque id, nonce, ttl. Payload data
    # arrives once through the private FIFO and is never persisted.
    if action == "supervise":
        return supervise(lease_id, nonce, ttl)
    return control(action, lease_id, nonce, ttl)


if __name__ == "__main__":
    raise SystemExit(main())
"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::ffi::CString;
    #[cfg(unix)]
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::ffi::OsStrExt;
    #[cfg(unix)]
    use std::os::unix::io::AsRawFd;
    #[cfg(unix)]
    use std::os::unix::process::CommandExt;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::process::Child;
    #[cfg(unix)]
    use std::time::Instant;

    #[cfg(unix)]
    struct LocalSupervisor {
        base: PathBuf,
        root: PathBuf,
        lease_id: String,
        nonce: String,
        child: Child,
    }

    #[cfg(unix)]
    impl LocalSupervisor {
        fn launch(command: String, ttl: f64) -> Self {
            let root = std::env::temp_dir().join(format!(
                "pickforge-remote-lease-test-{}-{}",
                std::process::id(),
                random_hex()
            ));
            std::fs::create_dir(&root).unwrap();
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
            let mut base = root.clone();
            for component in ["pickforge", "remote-leases", "v1"] {
                base.push(component);
                std::fs::create_dir(&base).unwrap();
                std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
            let script = base.join(SUPERVISOR_FILE);
            std::fs::write(&script, SUPERVISOR).unwrap();
            let lease_id = random_hex();
            let nonce = random_hex();
            let lease = base.join(&lease_id);
            std::fs::create_dir(&lease).unwrap();
            std::fs::set_permissions(&lease, std::fs::Permissions::from_mode(0o700)).unwrap();
            let fifo = lease.join("bootstrap");
            let fifo_c = CString::new(fifo.as_os_str().as_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) }, 0);
            let payload = RemoteLeasePayload::LoginCommand {
                cwd: base.to_string_lossy().into_owned(),
                command,
            };
            let encoded = String::from_utf8(serde_json::to_vec(&payload).unwrap()).unwrap();
            let writer_fifo = fifo.clone();
            std::thread::spawn(move || {
                let mut writer = std::fs::OpenOptions::new()
                    .write(true)
                    .open(writer_fifo)
                    .unwrap();
                writeln!(writer, "{encoded}").unwrap();
            });
            let child = Command::new("python3")
                .arg(&script)
                .arg("supervise")
                .arg(&lease_id)
                .arg(&nonce)
                .arg(ttl.to_string())
                .stdin(Stdio::null())
                .env("SHELL", "/bin/sh")
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap();
            Self {
                base,
                lease_id,
                root,
                nonce,
                child,
            }
        }

        fn lease_dir(&self) -> PathBuf {
            self.base.join(&self.lease_id)
        }

        fn state_path(&self) -> PathBuf {
            self.lease_dir().join("state.json")
        }

        fn state(&self) -> serde_json::Value {
            serde_json::from_slice(&std::fs::read(self.state_path()).unwrap()).unwrap()
        }


        fn control(&self, action: &str, ttl: f64) {
            let status = Command::new("python3")
                .arg(self.base.join(SUPERVISOR_FILE))
                .arg(action)
                .arg(&self.lease_id)
                .arg(&self.nonce)
                .arg(ttl.to_string())
                .status()
                .unwrap();
            assert!(status.success());
        }

        fn wait(mut self) {
            assert!(self.child.wait().unwrap().code().is_some());
        }
    }

    #[cfg(unix)]
    impl Drop for LocalSupervisor {
        fn drop(&mut self) {
            if let Ok(state) = std::fs::read(self.state_path())
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes)
                    .map_err(std::io::Error::other))
            {
                if let Some(pgid) = state["payload_pgid"].as_i64() {
                    unsafe {
                        libc::killpg(pgid as i32, libc::SIGKILL);
                    }
                }
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[cfg(unix)]
    fn python3_available() -> bool {
        Command::new("python3")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(unix)]
    struct TempRoot(PathBuf);

    #[cfg(unix)]
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    struct ProcessGroupGuard(Child);

    #[cfg(unix)]
    impl Drop for ProcessGroupGuard {
        fn drop(&mut self) {
            unsafe {
                libc::killpg(self.0.id() as i32, libc::SIGKILL);
            }
            let _ = self.0.wait();
        }
    }

    #[cfg(unix)]
    fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if condition() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(condition(), "condition did not become true within {timeout:?}");
    }

    #[cfg(unix)]
    fn process_exists(pid: i32) -> bool {
        let result = unsafe { libc::kill(pid, 0) };
        result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }

    #[test]
    fn launch_uses_encoded_payload_and_record_protocol_is_redacted() {
        let hostile = "say 'hello' $HOME `uname` secret-prompt";
        let payload = RemoteLeasePayload::LoginArgv {
            cwd: "/srv/hostile path".to_string(),
            argv: vec!["agent".to_string(), hostile.to_string()],
        };
        let handle = RemoteLeaseHandle::new(
            SshTarget::new("host").unwrap(),
            serde_json::to_vec(&payload).unwrap(),
        );
        let command = handle.launch_command();
        assert!(!command.contains(hostile));
        assert!(!command.contains("/srv/hostile path"));
        assert!(!build_bootstrap_command(handle.lease_id()).contains(hostile));
        assert!(command.contains(handle.lease_id()));
        assert!(SUPERVISOR.contains("\"protocol\": PROTOCOL"));
        assert!(!SUPERVISOR.contains("prompt\": payload"));
        handle.finish_natural();
    }

    #[cfg(unix)]
    #[test]
    fn worker_spawn_failure_runs_bounded_stop_inline() {
        let lease = Arc::new(RemoteLeaseHandle::new(
            SshTarget::new("127.0.0.1").unwrap(),
            Vec::new(),
        ));
        assert!(!lease.finalized.load(Ordering::SeqCst));
        let thread = spawn_or_stop_lease(Arc::clone(&lease), |_| {
            Err(std::io::Error::other("injected thread spawn failure"))
        });
        assert!(thread.is_none());
        assert!(lease.finalized.load(Ordering::SeqCst));
    }

    #[test]
    fn control_commands_carry_only_opaque_identity() {
        let command = build_control_command(
            "beat",
            "0123456789abcdef0123456789abcdef",
            "fedcba9876543210fedcba9876543210",
        );
        assert!(command.contains("beat"));
        assert!(!command.contains("/private/project"));
        assert!(!command.contains("secret-prompt"));

        let args = control_ssh_args(
            &SshTarget::new("host").unwrap(),
            command,
        );
        assert!(args.iter().any(|arg| arg == "ServerAliveInterval=2"));
        assert!(args.iter().any(|arg| arg == "ServerAliveCountMax=2"));
    }

    #[test]
    fn distinct_random_leases_do_not_share_identity() {
        let first = RemoteLeaseHandle::new(SshTarget::new("host").unwrap(), Vec::new());
        let second = RemoteLeaseHandle::new(SshTarget::new("host").unwrap(), Vec::new());
        assert_ne!(first.inner.lease_id, second.inner.lease_id);
        assert_ne!(first.inner.nonce, second.inner.nonce);
        first.finish_natural();
        second.finish_natural();
    }
    #[cfg(unix)]
    #[test]
    fn missing_python_fails_before_payload_launch() {
        let base = std::env::temp_dir().join(format!("pf-no-python-{}", random_hex()));
        let _base_guard = TempRoot(base.clone());
        let empty_path = base.join("empty-bin");
        std::fs::create_dir_all(&empty_path).unwrap();
        let marker = base.join("payload-ran");
        let command = build_bootstrap_command("0123456789abcdef0123456789abcdef");
        let status = Command::new("/bin/sh")
            .arg("-c")
            .arg(command)
            .env_clear()
            .env("PATH", &empty_path)
            .env("UID", "1000")
            .env("XDG_RUNTIME_DIR", &base)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(127));
        assert!(!marker.exists());
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn insecure_xdg_runtime_is_rejected_without_creating_a_lease() {
        if !python3_available() { return; }
        let root = std::env::temp_dir().join(format!("pf-insecure-runtime-{}", random_hex()));
        let _root_guard = TempRoot(root.clone());
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
        let status = Command::new("/bin/sh")
            .arg("-c")
            .arg(build_bootstrap_command("0123456789abcdef0123456789abcdef"))
            .env("XDG_RUNTIME_DIR", &root)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(126));
        assert!(!root.join("pickforge").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn bootstrap_ready_waits_for_private_fifo_and_payload() {
        if !python3_available() { return; }
        let root = std::env::temp_dir().join(format!("pf-bootstrap-ready-{}", random_hex()));
        let _root_guard = TempRoot(root.clone());
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let script = root.join("pickforge/remote-leases/v1").join(SUPERVISOR_FILE);
        let lease_id = random_hex();
        let mut child = Command::new("python3")
            .arg("-c")
            .arg(BOOTSTRAP_INSTALLER)
            .arg(&root)
            .arg("xdg")
            .arg(&script)
            .arg(hex_encode(SUPERVISOR.as_bytes()))
            .arg(&lease_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"mode":"login_shell","cwd":"/tmp"}"#)
            .unwrap();
        let mut ready = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut ready)
            .unwrap();
        assert_eq!(ready.trim(), BOOTSTRAP_READY);
        let fifo = root
            .join("pickforge/remote-leases/v1")
            .join(&lease_id)
            .join("bootstrap");
        assert!(fifo.exists());
        assert_eq!(
            std::fs::read(&fifo).unwrap(),
            br#"{"mode":"login_shell","cwd":"/tmp"}"#
        );
        assert!(child.wait().unwrap().success());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn unsupported_process_identity_fails_before_supervision() {
        if !python3_available() { return; }
        let base = std::env::temp_dir().join(format!("pf-unsupported-{}", random_hex()));
        let _base_guard = TempRoot(base.clone());
        std::fs::create_dir(&base).unwrap();
        let script = base.join(SUPERVISOR_FILE);
        std::fs::write(&script, SUPERVISOR).unwrap();
        let probe = r#"import importlib.util,sys
spec=importlib.util.spec_from_file_location("pflease",sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.platform.system=lambda: "Windows"
module.identity_for_self()"#;
        let status = Command::new("python3")
            .arg("-c")
            .arg(probe)
            .arg(&script)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(126));
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn parent_setpgid_exec_race_accepts_only_the_expected_group() {
        if !python3_available() { return; }
        let base = std::env::temp_dir().join(format!("pf-setpgid-race-{}", random_hex()));
        let _base_guard = TempRoot(base.clone());
        std::fs::create_dir(&base).unwrap();
        let script = base.join(SUPERVISOR_FILE);
        std::fs::write(&script, SUPERVISOR).unwrap();
        let probe = r#"import errno,importlib.util,sys
spec=importlib.util.spec_from_file_location("pflease",sys.argv[1])
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def denied(_pid,_pgid): raise OSError(errno.EACCES,"exec race")
m.os.setpgid=denied
m.os.getpgid=lambda pid: pid
assert m.establish_payload_group(42)
m.os.getpgid=lambda _pid: 7
assert not m.establish_payload_group(42)
def gone(_pid,_pgid): raise OSError(errno.ESRCH,"gone")
m.os.setpgid=gone
assert not m.establish_payload_group(42)"#;
        assert!(
            Command::new("python3")
                .arg("-c")
                .arg(probe)
                .arg(&script)
                .status()
                .unwrap()
                .success()
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn natural_exit_removes_private_state() {
        if !python3_available() { return; }
        let supervisor = LocalSupervisor::launch("exit 0".to_string(), 2.0);
        let lease_dir = supervisor.lease_dir();
        supervisor.wait();
        assert!(!lease_dir.exists());
    }

    #[cfg(unix)]
    #[test]
    fn bootstrap_fifo_read_has_a_hard_timeout() {
        if !python3_available() { return; }
        let root = std::env::temp_dir().join(format!("pf-fifo-timeout-{}", random_hex()));
        let _root_guard = TempRoot(root.clone());
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut base = root.clone();
        for component in ["pickforge", "remote-leases", "v1"] {
            base.push(component);
            std::fs::create_dir(&base).unwrap();
            std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let script = base.join(SUPERVISOR_FILE);
        assert!(SUPERVISOR.contains("deadline=time.monotonic()+30.0"));
        let short_supervisor =
            SUPERVISOR.replace("deadline=time.monotonic()+30.0", "deadline=time.monotonic()+0.2");
        std::fs::write(&script, short_supervisor).unwrap();
        let lease_id = random_hex();
        let nonce = random_hex();
        let lease = base.join(&lease_id);
        std::fs::create_dir(&lease).unwrap();
        std::fs::set_permissions(&lease, std::fs::Permissions::from_mode(0o700)).unwrap();
        let fifo = lease.join("bootstrap");
        let fifo_c = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) }, 0);
        let started = Instant::now();
        let status = Command::new("python3")
            .arg(&script)
            .arg("supervise")
            .arg(&lease_id)
            .arg(&nonce)
            .arg("45")
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(124));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!lease.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn watchdog_enforces_expiry_after_supervisor_sigkill() {
        if !python3_available() { return; }
        let mut supervisor = LocalSupervisor::launch(
            "trap '' TERM; while :; do sleep 1; done".to_string(),
            2.0,
        );
        wait_until(Duration::from_secs(3), || {
            supervisor.state_path().exists()
                && supervisor.state()["payload_pid"].as_i64().is_some()
        });
        let payload_pid = supervisor.state()["payload_pid"].as_i64().unwrap() as i32;
        unsafe {
            libc::kill(supervisor.child.id() as i32, libc::SIGKILL);
        }
        let _ = supervisor.child.wait();
        wait_until(Duration::from_secs(10), || {
            !process_exists(payload_pid) && !supervisor.state_path().exists()
        });
        let _ = std::fs::remove_dir_all(&supervisor.root);
    }

    #[cfg(unix)]
    #[test]
    fn verified_distinct_foreground_group_is_terminated() {
        if !python3_available() { return; }
        let base = std::env::temp_dir().join(format!("pf-foreground-{}", random_hex()));
        let _base_guard = TempRoot(base.clone());
        std::fs::create_dir(&base).unwrap();
        let script = base.join(SUPERVISOR_FILE);
        std::fs::write(&script, SUPERVISOR).unwrap();
        let harness = r#"import importlib.util,os,signal,subprocess,sys
spec=importlib.util.spec_from_file_location("pflease",sys.argv[1])
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cmd=["/bin/sh","-c","trap '' TERM; while :; do sleep 1; done"]
payload=subprocess.Popen(cmd,preexec_fn=os.setpgrp)
foreground=subprocess.Popen(cmd,preexec_fn=os.setpgrp)
try:
 birth=m.process_identity(payload.pid); session=os.getsid(payload.pid)
 m.os.isatty=lambda _fd: True
 m.os.tcgetpgrp=lambda _fd: foreground.pid
 m.terminate_payload(payload.pid,payload.pid,birth,session,can_wait=True,include_foreground=True)
 foreground.wait(timeout=3)
 if payload.poll() is None or foreground.poll() is None: raise SystemExit(1)
finally:
 for child in (payload,foreground):
  if child.poll() is None:
   os.killpg(child.pid,signal.SIGKILL); child.wait()"#;
        let status = Command::new("python3")
            .arg("-c")
            .arg(harness)
            .arg(&script)
            .status()
            .unwrap();
        assert!(status.success());
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn explicit_stop_kills_payload_tree_but_not_unrelated_group_and_redacts_state() {
        if !python3_available() { return; }
        let unrelated = ProcessGroupGuard(
            Command::new("/bin/sh")
                .arg("-c")
                .arg("trap '' TERM; while :; do sleep 1; done")
                .process_group(0)
                .spawn()
                .unwrap(),
        );
        let unrelated_pid = unrelated.0.id() as i32;

        let probe_base = std::env::temp_dir().join(format!("pf-lease-pids-{}", random_hex()));
        std::fs::create_dir_all(&probe_base).unwrap();
        let _probe_guard = TempRoot(probe_base.clone());
        let payload_file = probe_base.join("payload");
        let grandchild_file = probe_base.join("grandchild");
        let hostile = "do-not-persist ' $HOME `uname`";
        let command = format!(
            "echo $$ > {}; (trap '' TERM; while :; do sleep 1; done) & echo $! > {}; trap '' TERM; while :; do sleep 1; done # {}",
            payload_file.display(),
            grandchild_file.display(),
            hostile
        );
        let supervisor = LocalSupervisor::launch(command, 5.0);
        wait_until(Duration::from_secs(3), || {
            supervisor.state_path().exists()
                && payload_file.exists()
                && grandchild_file.exists()
        });
        let state = supervisor.state();
        let supervisor_pid = state["supervisor_pid"].as_i64().unwrap() as i32;
        let payload_pid = state["payload_pid"].as_i64().unwrap() as i32;
        let payload_pgid = state["payload_pgid"].as_i64().unwrap() as i32;
        let grandchild_pid = std::fs::read_to_string(&grandchild_file)
            .unwrap()
            .trim()
            .parse::<i32>()
            .unwrap();
        assert_ne!(payload_pgid, supervisor_pid);
        assert_eq!(payload_pid, payload_pgid);
        let record = serde_json::to_string(&state).unwrap();
        assert!(!record.contains(hostile));
        assert!(!record.contains(probe_base.to_string_lossy().as_ref()));

        supervisor.control("stop", 5.0);
        wait_until(Duration::from_secs(4), || {
            !process_exists(payload_pid) && !process_exists(grandchild_pid)
        });
        assert!(process_exists(unrelated_pid));
        supervisor.wait();

    }

    #[cfg(unix)]
    #[test]
    fn heartbeat_extends_deadline_and_expiry_cannot_be_revived() {
        if !python3_available() { return; }
        let supervisor = LocalSupervisor::launch(
            "trap '' TERM; while :; do sleep 1; done".to_string(),
            2.0,
        );
        wait_until(Duration::from_secs(3), || {
            supervisor.state_path().exists()
                && supervisor.state()["payload_pid"].as_i64().is_some()
        });
        let payload_pid = supervisor.state()["payload_pid"].as_i64().unwrap() as i32;
        std::thread::sleep(Duration::from_millis(1_200));
        supervisor.control("beat", 2.0);
        std::thread::sleep(Duration::from_millis(1_200));
        assert!(supervisor.state_path().exists());
        assert!(process_exists(payload_pid));

        wait_until(Duration::from_secs(6), || !supervisor.state_path().exists());
        supervisor.control("beat", 2.0);
        std::thread::sleep(Duration::from_millis(150));
        assert!(!supervisor.state_path().exists());
        assert!(!process_exists(payload_pid));
        supervisor.wait();
    }

    #[cfg(unix)]
    #[test]
    fn stale_supervisor_identity_never_signals_recorded_group() {
        if !python3_available() { return; }
        let unrelated = ProcessGroupGuard(
            Command::new("/bin/sh")
                .arg("-c")
                .arg("trap '' TERM; while :; do sleep 1; done")
                .process_group(0)
                .spawn()
                .unwrap(),
        );
        let unrelated_pid = unrelated.0.id() as i32;
        let root = std::env::temp_dir().join(format!("pf-stale-lease-{}", random_hex()));
        std::fs::create_dir(&root).unwrap();
        let _root_guard = TempRoot(root.clone());
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut base = root.clone();
        for component in ["pickforge", "remote-leases", "v1"] {
            base.push(component);
            std::fs::create_dir(&base).unwrap();
            std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::fs::write(base.join(SUPERVISOR_FILE), SUPERVISOR).unwrap();
        let lease_id = random_hex();
        let nonce = random_hex();
        let lease = base.join(&lease_id);
        std::fs::create_dir(&lease).unwrap();
        std::fs::set_permissions(&lease, std::fs::Permissions::from_mode(0o700)).unwrap();
        let live = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(lease.join("live.lock"))
            .unwrap();
        std::fs::set_permissions(
            lease.join("live.lock"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        assert_eq!(unsafe { libc::flock(live.as_raw_fd(), libc::LOCK_EX) }, 0);
        std::fs::write(lease.join("state.lock"), b"").unwrap();
        std::fs::set_permissions(
            lease.join("state.lock"),
            std::fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        let state = serde_json::json!({
            "protocol": "pickforge-remote-lease-v1",
            "lease_id": lease_id,
            "supervisor_pid": unrelated_pid,
            "nonce": nonce,
            "supervisor_identity": {"kind": "linux-proc-start-v1", "start": "stale"},
            "payload_pid": unrelated_pid,
            "payload_pgid": unrelated_pid,
            "state": "running",
            "expiry": 99999999999.0
        });
        std::fs::write(
            lease.join("state.json"),
            serde_json::to_vec(&state).unwrap(),
        )
        .unwrap();
        let status = Command::new("python3")
            .arg(base.join(SUPERVISOR_FILE))
            .arg("stop")
            .arg(&lease_id)
            .arg(&nonce)
            .arg("1")
            .status()
            .unwrap();
        assert!(status.success());
        assert!(process_exists(unrelated_pid));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &std::fs::read(lease.join("state.json")).unwrap()
            )
            .unwrap()["state"],
            "running"
        );
    }
}
