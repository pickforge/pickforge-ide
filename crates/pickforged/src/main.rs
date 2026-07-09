use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pickforge_core::{
    parse_listener, remote_auth_store_path, spawn_remote_http_server, tailscale_ssh_set,
    tailscale_status, DaemonConfig, DaemonListener, DaemonStatus, PairingCode, RemoteAuthStore,
    RemoteAuthStoreSnapshot, RemoteHostDaemon, REMOTE_PROTOCOL_NAME,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

const RUNTIME_STATE_FILE: &str = "pickforged-state.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonRuntimeState {
    pid: u32,
    listener_addr: String,
}

struct RuntimeStateFileGuard {
    path: PathBuf,
}

impl Drop for RuntimeStateFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("pickforged: {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        print_help();
        return Ok(());
    }

    match args[0].as_str() {
        "--status-json" | "status" => print_status(),
        "serve" => serve(&args[1..]).await,
        "pair" => issue_pairing_code(&args[1..]),
        "clients" => print_clients(),
        "revoke" => revoke_client(&args[1..]),
        "tailscale-status" => print_json(&tailscale_status()),
        "tailscale-ssh-on" => print_json(&tailscale_ssh_set(true)?),
        "tailscale-ssh-off" => print_json(&tailscale_ssh_set(false)?),
        other => Err(format!("unknown command '{other}'")),
    }
}

fn print_help() {
    println!(
        "pickforged commands:
  status | --status-json
  serve --listen 127.0.0.1:4747
  pair [--ttl-ms 600000]
  clients
  revoke <client-id>
  tailscale-status
  tailscale-ssh-on
  tailscale-ssh-off"
    );
}

fn print_status() -> Result<(), String> {
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    if let Some(state) = live_runtime_state(&home)? {
        return print_json(&status_json_from_runtime_state(
            &home,
            &state,
            status_endpoint_reports_daemon,
        )?);
    }

    let config = DaemonConfig::from_env(None).map_err(|err| err.to_string())?;
    let mut status = serde_json::to_value(status_from_config(config.clone())?)
        .map_err(|err| err.to_string())?;
    status["listenerRunning"] = json!(listener_running_from_config(&config));
    print_json(&status)
}

async fn serve(args: &[String]) -> Result<(), String> {
    let listener = listener_arg(args)?.ok_or("missing --listen <loopback-host:port>")?;
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    let server = spawn_remote_http_server(DaemonConfig {
        pickforge_home: home.clone(),
        listener,
    })
    .await
    .map_err(|err| err.to_string())?;
    let runtime_state = DaemonRuntimeState {
        pid: std::process::id(),
        listener_addr: server.info().local_addr.to_string(),
    };
    let runtime_guard = match write_runtime_state(&home, &runtime_state) {
        Ok(guard) => guard,
        Err(err) => {
            let _ = server.shutdown().await;
            return Err(err);
        }
    };
    println!(
        "pickforged listening on http://{}",
        server.info().local_addr
    );
    let signal_result = wait_for_shutdown_signal().await;
    let shutdown_result = server.shutdown().await.map_err(|err| err.to_string());
    drop(runtime_guard);
    signal_result?;
    shutdown_result
}

fn issue_pairing_code(args: &[String]) -> Result<(), String> {
    let ttl_ms = numeric_arg(args, "--ttl-ms")?.unwrap_or(10 * 60 * 1000);
    let path = auth_path()?;
    let code = issue_pairing_code_at(&path, ttl_ms)?;
    print_json(&code)
}

fn print_clients() -> Result<(), String> {
    let path = auth_path()?;
    print_json(&clients_json_from_path(&path)?)
}

fn revoke_client(args: &[String]) -> Result<(), String> {
    let client_id = args.first().ok_or("missing client id")?;
    let path = auth_path()?;
    revoke_client_at(&path, client_id)?;
    print_json(&json!({ "clientId": client_id, "revoked": true }))
}

fn status_from_config(config: DaemonConfig) -> Result<DaemonStatus, String> {
    let daemon = RemoteHostDaemon::new(config).map_err(|err| err.to_string())?;
    Ok(daemon.status(now_ms()))
}

fn listener_running_from_config(config: &DaemonConfig) -> bool {
    let Ok(daemon) = RemoteHostDaemon::new(config.clone()) else {
        return false;
    };
    let Some(target) = daemon.bind_target() else {
        return false;
    };
    status_endpoint_reports_daemon(&target)
}

fn runtime_state_path(home: &str) -> PathBuf {
    Path::new(home).join(RUNTIME_STATE_FILE)
}

fn write_runtime_state(
    home: &str,
    state: &DaemonRuntimeState,
) -> Result<RuntimeStateFileGuard, String> {
    let path = runtime_state_path(home);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let tmp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    let json = serde_json::to_vec_pretty(state).map_err(|err| err.to_string())?;
    if let Err(err) = fs::write(&tmp, json) {
        let _ = fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    if let Err(err) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    Ok(RuntimeStateFileGuard { path })
}

fn live_runtime_state(home: &str) -> Result<Option<DaemonRuntimeState>, String> {
    live_runtime_state_from_path(&runtime_state_path(home), pid_is_alive)
}

fn live_runtime_state_from_path(
    path: &Path,
    pid_alive: impl Fn(u32) -> bool,
) -> Result<Option<DaemonRuntimeState>, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
    };
    let state: DaemonRuntimeState =
        serde_json::from_slice(&raw).map_err(|err| err.to_string())?;
    if pid_alive(state.pid) {
        Ok(Some(state))
    } else {
        let _ = fs::remove_file(path);
        Ok(None)
    }
}

fn status_json_from_runtime_state(
    home: &str,
    state: &DaemonRuntimeState,
    listener_running: impl FnOnce(&str) -> bool,
) -> Result<serde_json::Value, String> {
    let listener = parse_listener(&state.listener_addr).map_err(|err| err.to_string())?;
    let config = DaemonConfig {
        pickforge_home: home.into(),
        listener,
    };
    let mut status = serde_json::to_value(status_from_config(config)?)
        .map_err(|err| err.to_string())?;
    status["listenerRunning"] = json!(listener_running(&state.listener_addr));
    Ok(status)
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(not(unix))]
fn pid_is_alive(pid: u32) -> bool {
    pid == std::process::id()
}

#[cfg(unix)]
async fn wait_for_shutdown_signal() -> Result<(), String> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|err| err.to_string())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result.map_err(|err| err.to_string()),
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn wait_for_shutdown_signal() -> Result<(), String> {
    tokio::signal::ctrl_c()
        .await
        .map_err(|err| err.to_string())
}

fn status_endpoint_reports_daemon(target: &str) -> bool {
    let Ok(addrs) = target.to_socket_addrs() else {
        return false;
    };
    for addr in addrs {
        let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
            continue;
        };
        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
        let request = format!("GET /status HTTP/1.1\r\nhost: {target}\r\nconnection: close\r\n\r\n");
        if stream.write_all(request.as_bytes()).is_err() {
            continue;
        }
        let mut response = String::new();
        if stream.read_to_string(&mut response).is_err() {
            continue;
        }
        if status_response_is_daemon(&response) {
            return true;
        }
    }
    false
}

fn status_response_is_daemon(response: &str) -> bool {
    let Some((head, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };
    let Some(status_line) = head.lines().next() else {
        return false;
    };
    if !status_line.contains(" 200 ") {
        return false;
    }
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    json.get("protocol").and_then(serde_json::Value::as_str) == Some(REMOTE_PROTOCOL_NAME)
        && json
            .get("listenerEnabled")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
}

fn auth_path() -> Result<PathBuf, String> {
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    Ok(remote_auth_store_path(&home))
}

fn issue_pairing_code_at(path: &Path, ttl_ms: i64) -> Result<PairingCode, String> {
    RemoteAuthStore::update_path(path, |store| store.issue_pairing_code(now_ms(), ttl_ms))
        .map_err(|err| err.to_string())
}

fn clients_json_from_path(path: &Path) -> Result<serde_json::Value, String> {
    let snapshot = RemoteAuthStore::snapshot_from_path(&path).map_err(|err| err.to_string())?;
    Ok(clients_json(snapshot))
}

fn clients_json(snapshot: RemoteAuthStoreSnapshot) -> serde_json::Value {
    let clients: Vec<_> = snapshot
        .clients
        .into_iter()
        .map(|client| {
            json!({
                "clientId": client.client_id,
                "clientName": client.client_name,
                "issuedAtMs": client.issued_at_ms,
                "lastSeenAtMs": client.last_seen_at_ms,
                "revokedAtMs": client.revoked_at_ms,
            })
        })
        .collect();
    json!({ "clients": clients })
}

fn revoke_client_at(path: &Path, client_id: &str) -> Result<(), String> {
    RemoteAuthStore::update_path(path, |store| store.revoke_client(client_id, now_ms()))
        .map_err(|err| err.to_string())
}

fn listener_arg(args: &[String]) -> Result<Option<DaemonListener>, String> {
    match value_arg(args, "--listen") {
        Some(raw) => parse_listener(&raw)
            .map(Some)
            .map_err(|err| err.to_string()),
        None => Ok(None),
    }
}

fn numeric_arg(args: &[String], name: &str) -> Result<Option<i64>, String> {
    let Some(raw) = value_arg(args, name) else {
        return Ok(None);
    };
    raw.parse::<i64>()
        .map(Some)
        .map_err(|_| format!("{name} must be a number"))
}

fn value_arg(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn print_json<T: serde::Serialize>(value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    println!("{json}");
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_PATH: AtomicU64 = AtomicU64::new(1);

    fn temp_auth_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pickforged-{name}-{}-{}-{}",
            std::process::id(),
            now_ms(),
            NEXT_PATH.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        remote_auth_store_path(&dir.to_string_lossy())
    }

    fn temp_state_path(name: &str) -> PathBuf {
        temp_auth_path(name).with_file_name(RUNTIME_STATE_FILE)
    }

    #[test]
    fn arg_parsers_validate_listener_and_ports() {
        let args = vec![
            "--listen".to_string(),
            "127.0.0.1:4747".to_string(),
            "--ttl-ms".to_string(),
            "60000".to_string(),
        ];

        assert_eq!(
            value_arg(&args, "--listen").as_deref(),
            Some("127.0.0.1:4747")
        );
        assert_eq!(numeric_arg(&args, "--ttl-ms").unwrap(), Some(60_000));
        assert!(matches!(
            listener_arg(&args).unwrap(),
            Some(DaemonListener::Loopback { port: 4747, .. })
        ));

        let bad_number = vec!["--ttl-ms".to_string(), "soon".to_string()];
        assert_eq!(
            numeric_arg(&bad_number, "--ttl-ms").unwrap_err(),
            "--ttl-ms must be a number"
        );

        let wildcard = vec!["--listen".to_string(), "0.0.0.0:4747".to_string()];
        assert!(listener_arg(&wildcard).is_err());
    }

    #[test]
    fn status_from_config_reports_disabled_and_loopback_listeners() {
        let disabled = status_from_config(DaemonConfig::disabled("/tmp/pickforge")).unwrap();
        assert!(!disabled.listener_enabled);

        let loopback = status_from_config(DaemonConfig {
            pickforge_home: "/tmp/pickforge".into(),
            listener: DaemonListener::loopback("127.0.0.1", 4747).unwrap(),
        })
        .unwrap();
        assert!(loopback.listener_enabled);
    }

    #[test]
    fn runtime_state_file_reads_live_pid() {
        let path = temp_state_path("runtime-live");
        let state = DaemonRuntimeState {
            pid: 123,
            listener_addr: "127.0.0.1:4747".into(),
        };
        fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();

        let loaded = live_runtime_state_from_path(&path, |pid| pid == 123)
            .unwrap()
            .unwrap();

        assert_eq!(loaded, state);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn runtime_state_file_removes_stale_pid() {
        let path = temp_state_path("runtime-stale");
        let state = DaemonRuntimeState {
            pid: 123,
            listener_addr: "127.0.0.1:4747".into(),
        };
        fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();

        assert_eq!(
            live_runtime_state_from_path(&path, |_| false).unwrap(),
            None
        );
        assert!(!path.exists());
    }

    #[test]
    fn status_from_runtime_state_reports_saved_listener() {
        let state = DaemonRuntimeState {
            pid: 123,
            listener_addr: "127.0.0.1:4747".into(),
        };

        let status = status_json_from_runtime_state("/tmp/pickforge", &state, |addr| {
            assert_eq!(addr, "127.0.0.1:4747");
            true
        })
        .unwrap();

        assert_eq!(status["listenerEnabled"], json!(true));
        assert_eq!(status["listenerRunning"], json!(true));
        assert_eq!(status["listener"]["kind"], json!("loopback"));
        assert_eq!(status["listener"]["port"], json!(4747));
    }

    #[test]
    fn status_response_requires_pickforged_enabled_listener() {
        let ok = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{}",
            json!({
                "protocol": REMOTE_PROTOCOL_NAME,
                "listenerEnabled": true,
            })
        );
        assert!(status_response_is_daemon(&ok));

        let disabled = format!(
            "HTTP/1.1 200 OK\r\n\r\n{}",
            json!({
                "protocol": REMOTE_PROTOCOL_NAME,
                "listenerEnabled": false,
            })
        );
        assert!(!status_response_is_daemon(&disabled));

        let wrong_protocol =
            "HTTP/1.1 200 OK\r\n\r\n{\"protocol\":\"other\",\"listenerEnabled\":true}";
        assert!(!status_response_is_daemon(wrong_protocol));
        assert!(!status_response_is_daemon(&ok.replacen("200 OK", "503 Service Unavailable", 1)));
        assert!(!status_response_is_daemon("HTTP/1.1 200 OK\r\n\r\nnot-json"));
    }

    #[test]
    fn auth_helpers_issue_list_and_revoke_clients() {
        let path = temp_auth_path("auth-flow");
        let code = issue_pairing_code_at(&path, 60_000).unwrap();
        let issued = RemoteAuthStore::update_path(&path, |store| {
            store.exchange_pairing_code(&code.code, "CLI client", now_ms())
        })
        .unwrap();

        let clients = clients_json_from_path(&path).unwrap();
        assert_eq!(clients["clients"][0]["clientId"], issued.client_id);
        assert_eq!(clients["clients"][0]["clientName"], "CLI client");
        assert!(clients["clients"][0].get("tokenHash").is_none());

        revoke_client_at(&path, &issued.client_id).unwrap();
        let snapshot = RemoteAuthStore::snapshot_from_path(&path).unwrap();
        assert!(snapshot.clients[0].revoked_at_ms.is_some());

        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn auth_helpers_reject_invalid_input() {
        let path = temp_auth_path("bad-auth");
        assert!(issue_pairing_code_at(&path, 0)
            .unwrap_err()
            .contains("pairing ttl must be positive"));
        assert!(revoke_client_at(&path, "missing")
            .unwrap_err()
            .contains("client was not found"));
        assert_eq!(revoke_client(&[]).unwrap_err(), "missing client id");

        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

}
