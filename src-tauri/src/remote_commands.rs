use std::sync::Mutex;

use pickforge_core::{
    listener_from_parts, pickforge_home, remote_auth_store_path, spawn_remote_http_server,
    tailscale_serve_disable, tailscale_serve_enable, tailscale_ssh_set, tailscale_status,
    ClientTokenRecord, DaemonConfig, DaemonListener, PairingCode, RemoteAuthStore,
    RemoteHttpServer, RemoteHttpServerInfo, TailscaleStatus,
};
use serde::Serialize;
use tauri::State;

const DEFAULT_REMOTE_HOST: &str = "127.0.0.1";
const DEFAULT_REMOTE_PORT: u16 = 4747;
const DEFAULT_PAIRING_TTL_MS: i64 = 10 * 60 * 1000;
const DEFAULT_TAILSCALE_HTTPS_PORT: u16 = 443;

pub struct RemoteHostState {
    server: Mutex<Option<RemoteHttpServer>>,
}

impl RemoteHostState {
    pub fn new() -> Self {
        Self {
            server: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostOverview {
    pub running: bool,
    pub listener: DaemonListener,
    pub local_url: Option<String>,
    pub auth_path: String,
    pub pairing_codes: Vec<PairingCode>,
    pub clients: Vec<RemoteClientSummary>,
    pub tailscale: TailscaleStatus,
    pub default_host: String,
    pub default_port: u16,
    pub default_https_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteClientSummary {
    pub client_id: String,
    pub client_name: String,
    pub issued_at_ms: i64,
    pub last_seen_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}

impl From<ClientTokenRecord> for RemoteClientSummary {
    fn from(client: ClientTokenRecord) -> Self {
        Self {
            client_id: client.client_id,
            client_name: client.client_name,
            issued_at_ms: client.issued_at_ms,
            last_seen_at_ms: client.last_seen_at_ms,
            revoked_at_ms: client.revoked_at_ms,
        }
    }
}

#[tauri::command]
pub async fn remote_host_status(
    state: State<'_, RemoteHostState>,
) -> Result<RemoteHostOverview, String> {
    overview(&state)
}

#[tauri::command]
pub async fn remote_host_start(
    state: State<'_, RemoteHostState>,
    host: String,
    port: u16,
) -> Result<RemoteHostOverview, String> {
    let listener = listener_from_parts(host, port).map_err(|err| err.to_string())?;
    {
        let guard = state
            .server
            .lock()
            .map_err(|_| "remote host state poisoned".to_string())?;
        if guard.is_some() {
            return Err("remote host listener is already running".into());
        }
    }
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    let server = spawn_remote_http_server(DaemonConfig {
        pickforge_home: home,
        listener,
    })
    .await
    .map_err(|err| err.to_string())?;
    state
        .server
        .lock()
        .map_err(|_| "remote host state poisoned".to_string())?
        .replace(server);
    overview(&state)
}

#[tauri::command]
pub async fn remote_host_stop(
    state: State<'_, RemoteHostState>,
) -> Result<RemoteHostOverview, String> {
    let server = state
        .server
        .lock()
        .map_err(|_| "remote host state poisoned".to_string())?
        .take();
    if let Some(server) = server {
        server.shutdown().await.map_err(|err| err.to_string())?;
    }
    overview(&state)
}

#[tauri::command]
pub fn remote_host_issue_pairing_code(ttl_ms: Option<i64>) -> Result<PairingCode, String> {
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    let path = remote_auth_store_path(&home);
    let mut store = RemoteAuthStore::load_from_path(&path).map_err(|err| err.to_string())?;
    let code = store
        .issue_pairing_code(now_ms(), ttl_ms.unwrap_or(DEFAULT_PAIRING_TTL_MS))
        .map_err(|err| err.to_string())?;
    store.save_to_path(&path).map_err(|err| err.to_string())?;
    Ok(code)
}

#[tauri::command]
pub fn remote_host_revoke_client(client_id: String) -> Result<(), String> {
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    let path = remote_auth_store_path(&home);
    let mut store = RemoteAuthStore::load_from_path(&path).map_err(|err| err.to_string())?;
    store
        .revoke_client(&client_id, now_ms())
        .map_err(|err| err.to_string())?;
    store.save_to_path(&path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn remote_tailscale_serve_enable(
    host: String,
    port: u16,
    https_port: Option<u16>,
) -> Result<TailscaleStatus, String> {
    let listener = listener_from_parts(host, port).map_err(|err| err.to_string())?;
    tailscale_serve_enable(
        &listener,
        https_port.unwrap_or(DEFAULT_TAILSCALE_HTTPS_PORT),
    )
}

#[tauri::command]
pub fn remote_tailscale_serve_disable(https_port: Option<u16>) -> Result<TailscaleStatus, String> {
    tailscale_serve_disable(https_port.unwrap_or(DEFAULT_TAILSCALE_HTTPS_PORT))
}

#[tauri::command]
pub fn remote_tailscale_ssh_set(enabled: bool) -> Result<TailscaleStatus, String> {
    tailscale_ssh_set(enabled)
}

fn overview(state: &RemoteHostState) -> Result<RemoteHostOverview, String> {
    let server = state
        .server
        .lock()
        .map_err(|_| "remote host state poisoned".to_string())?
        .as_ref()
        .map(RemoteHttpServer::info);
    let listener = listener_from_server(server.as_ref());
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    let path = remote_auth_store_path(&home);
    let snapshot = RemoteAuthStore::load_from_path(&path)
        .map_err(|err| err.to_string())?
        .snapshot();
    let local_url = server
        .as_ref()
        .map(|info| format!("http://{}", info.local_addr));
    Ok(RemoteHostOverview {
        running: server.is_some(),
        listener,
        local_url,
        auth_path: path.to_string_lossy().into_owned(),
        pairing_codes: snapshot.pairing_codes,
        clients: snapshot.clients.into_iter().map(Into::into).collect(),
        tailscale: tailscale_status(),
        default_host: DEFAULT_REMOTE_HOST.into(),
        default_port: DEFAULT_REMOTE_PORT,
        default_https_port: DEFAULT_TAILSCALE_HTTPS_PORT,
    })
}

fn listener_from_server(server: Option<&RemoteHttpServerInfo>) -> DaemonListener {
    server
        .map(|info| DaemonListener::Loopback {
            host: info.local_addr.ip().to_string(),
            port: info.local_addr.port(),
        })
        .unwrap_or(DaemonListener::Disabled)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
