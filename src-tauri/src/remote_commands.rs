use std::path::{Path, PathBuf};
use std::sync::Mutex;

use pickforge_core::{
    listener_from_parts, pickforge_home, remote_auth_store_path, spawn_remote_http_server,
    tailscale_ssh_set, tailscale_status, ClientTokenRecord, DaemonConfig, DaemonListener,
    PairingCode, RemoteAuthStore, RemoteHttpServer, RemoteHttpServerInfo, TailscaleStatus,
};
use serde::Serialize;
use tauri::State;

const DEFAULT_REMOTE_HOST: &str = "127.0.0.1";
const DEFAULT_REMOTE_PORT: u16 = 4747;
const DEFAULT_PAIRING_TTL_MS: i64 = 10 * 60 * 1000;

pub struct RemoteHostState {
    server: Mutex<RemoteHostSlot>,
}

enum RemoteHostSlot {
    Idle,
    Starting,
    Running(RemoteHttpServer),
}

impl RemoteHostState {
    pub fn new() -> Self {
        Self {
            server: Mutex::new(RemoteHostSlot::Idle),
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
    overview(&state).await
}

#[tauri::command]
pub async fn remote_host_start(
    state: State<'_, RemoteHostState>,
    host: String,
    port: u16,
) -> Result<RemoteHostOverview, String> {
    let listener = listener_from_parts(host, port).map_err(|err| err.to_string())?;
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    state.reserve_start()?;
    let server = match spawn_remote_http_server(DaemonConfig {
        pickforge_home: home.clone(),
        listener,
    })
    .await
    {
        Ok(server) => server,
        Err(err) => {
            state.clear_starting()?;
            return Err(err.to_string());
        }
    };
    state.publish_server_and_overview(home, server).await
}

#[tauri::command]
pub async fn remote_host_stop(
    state: State<'_, RemoteHostState>,
) -> Result<RemoteHostOverview, String> {
    let server = state.take_running_server()?;
    if let Some(server) = server {
        server.shutdown().await.map_err(|err| err.to_string())?;
    }
    overview(&state).await
}

#[tauri::command]
pub fn remote_host_issue_pairing_code(ttl_ms: Option<i64>) -> Result<PairingCode, String> {
    let path = auth_path()?;
    issue_pairing_code_at(&path, ttl_ms.unwrap_or(DEFAULT_PAIRING_TTL_MS))
}

#[tauri::command]
pub fn remote_host_revoke_client(client_id: String) -> Result<(), String> {
    let path = auth_path()?;
    revoke_client_at(&path, &client_id)
}

#[tauri::command]
pub async fn remote_tailscale_ssh_set(enabled: bool) -> Result<TailscaleStatus, String> {
    run_tailscale_action(move || tailscale_ssh_set(enabled)).await
}

impl RemoteHostState {
    fn reserve_start(&self) -> Result<(), String> {
        let mut slot = self
            .server
            .lock()
            .map_err(|_| "remote host state poisoned".to_string())?;
        match &*slot {
            RemoteHostSlot::Idle => {
                *slot = RemoteHostSlot::Starting;
                Ok(())
            }
            RemoteHostSlot::Starting | RemoteHostSlot::Running(_) => {
                Err("remote host listener is already running".into())
            }
        }
    }

    fn clear_starting(&self) -> Result<(), String> {
        let mut slot = self
            .server
            .lock()
            .map_err(|_| "remote host state poisoned".to_string())?;
        if matches!(&*slot, RemoteHostSlot::Starting) {
            *slot = RemoteHostSlot::Idle;
        }
        Ok(())
    }

    fn take_running_server(&self) -> Result<Option<RemoteHttpServer>, String> {
        let mut slot = self
            .server
            .lock()
            .map_err(|_| "remote host state poisoned".to_string())?;
        match &*slot {
            RemoteHostSlot::Idle => Ok(None),
            RemoteHostSlot::Starting => Err("remote host listener is starting".into()),
            RemoteHostSlot::Running(_) => match std::mem::replace(&mut *slot, RemoteHostSlot::Idle)
            {
                RemoteHostSlot::Running(server) => Ok(Some(server)),
                _ => unreachable!(),
            },
        }
    }

    async fn publish_server_and_overview(
        &self,
        home: String,
        server: RemoteHttpServer,
    ) -> Result<RemoteHostOverview, String> {
        let mut server = Some(server);
        let store_result = {
            let mut slot = self
                .server
                .lock()
                .map_err(|_| "remote host state poisoned".to_string())?;
            match &*slot {
                RemoteHostSlot::Starting => {
                    *slot = RemoteHostSlot::Running(server.take().unwrap());
                    Ok(())
                }
                RemoteHostSlot::Idle | RemoteHostSlot::Running(_) => {
                    Err("remote host listener start was not reserved".to_string())
                }
            }
        };
        if let Err(err) = store_result {
            if let Some(server) = server {
                server.shutdown().await.map_err(|shutdown_err| {
                    format!("{err}; failed to stop remote listener: {shutdown_err}")
                })?;
            }
            return Err(err);
        }

        match overview_for_home(self, home).await {
            Ok(overview) => Ok(overview),
            Err(err) => {
                let server = self.take_running_server()?;
                if let Some(server) = server {
                    server.shutdown().await.map_err(|shutdown_err| {
                        format!("{err}; failed to stop remote listener: {shutdown_err}")
                    })?;
                }
                Err(err)
            }
        }
    }
}

async fn overview(state: &RemoteHostState) -> Result<RemoteHostOverview, String> {
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    overview_for_home(state, home).await
}

async fn overview_for_home(
    state: &RemoteHostState,
    home: String,
) -> Result<RemoteHostOverview, String> {
    let server = current_server_info(state)?;
    tauri::async_runtime::spawn_blocking(move || {
        overview_from_parts(&home, server, tailscale_status())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn current_server_info(state: &RemoteHostState) -> Result<Option<RemoteHttpServerInfo>, String> {
    let slot = state
        .server
        .lock()
        .map_err(|_| "remote host state poisoned".to_string())?;
    match &*slot {
        RemoteHostSlot::Running(server) => Ok(Some(server.info())),
        RemoteHostSlot::Idle | RemoteHostSlot::Starting => Ok(None),
    }
}

fn overview_from_parts(
    home: &str,
    server: Option<RemoteHttpServerInfo>,
    tailscale: TailscaleStatus,
) -> Result<RemoteHostOverview, String> {
    let listener = listener_from_server(server.as_ref());
    let path = remote_auth_store_path(&home);
    let snapshot = RemoteAuthStore::snapshot_from_path(&path).map_err(|err| err.to_string())?;
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
        tailscale,
        default_host: DEFAULT_REMOTE_HOST.into(),
        default_port: DEFAULT_REMOTE_PORT,
    })
}

fn auth_path() -> Result<PathBuf, String> {
    let home = pickforge_home(None).map_err(|err| err.to_string())?;
    Ok(remote_auth_store_path(&home))
}

fn issue_pairing_code_at(path: &Path, ttl_ms: i64) -> Result<PairingCode, String> {
    RemoteAuthStore::update_path(path, |store| store.issue_pairing_code(now_ms(), ttl_ms))
        .map_err(|err| err.to_string())
}

fn revoke_client_at(path: &Path, client_id: &str) -> Result<(), String> {
    RemoteAuthStore::update_path(path, |store| store.revoke_client(client_id, now_ms()))
        .map_err(|err| err.to_string())
}

fn listener_from_server(server: Option<&RemoteHttpServerInfo>) -> DaemonListener {
    server
        .map(|info| DaemonListener::Loopback {
            host: info.local_addr.ip().to_string(),
            port: info.local_addr.port(),
        })
        .unwrap_or(DaemonListener::Disabled)
}

async fn run_tailscale_action(
    action: impl FnOnce() -> Result<TailscaleStatus, String> + Send + 'static,
) -> Result<TailscaleStatus, String> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|err| err.to_string())?
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_HOME: AtomicU64 = AtomicU64::new(1);

    fn unavailable_tailscale() -> TailscaleStatus {
        TailscaleStatus {
            available: false,
            binary_path: None,
            version: None,
            backend_state: None,
            online: None,
            host_name: None,
            dns_name: None,
            tailscale_ips: Vec::new(),
            ssh_capable: false,
            ssh_enabled: None,
            error: Some("not installed".into()),
        }
    }

    fn temp_home(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!(
            "pickforge-tauri-remote-{name}-{}-{}-{}",
            std::process::id(),
            now_ms(),
            NEXT_HOME.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    #[test]
    fn pairing_and_revoke_helpers_update_locked_store() {
        let home = temp_home("auth-flow");
        let path = remote_auth_store_path(&home);
        let code = issue_pairing_code_at(&path, 60_000).unwrap();
        let issued = RemoteAuthStore::update_path(&path, |store| {
            store.exchange_pairing_code(&code.code, "Tauri client", now_ms())
        })
        .unwrap();

        revoke_client_at(&path, &issued.client_id).unwrap();
        let snapshot = RemoteAuthStore::snapshot_from_path(&path).unwrap();
        assert_eq!(snapshot.clients[0].client_name, "Tauri client");
        assert!(snapshot.clients[0].revoked_at_ms.is_some());

        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn overview_for_home_redacts_client_secrets() {
        let home = temp_home("overview");
        let path = remote_auth_store_path(&home);
        let code = issue_pairing_code_at(&path, 60_000).unwrap();
        let issued = RemoteAuthStore::update_path(&path, |store| {
            store.exchange_pairing_code(&code.code, "Overview client", now_ms())
        })
        .unwrap();

        let overview = overview_from_parts(&home, None, unavailable_tailscale()).unwrap();
        assert!(!overview.running);
        assert_eq!(overview.listener, DaemonListener::Disabled);
        assert_eq!(overview.local_url, None);
        assert_eq!(overview.auth_path, path.to_string_lossy().as_ref());
        assert_eq!(overview.default_host, DEFAULT_REMOTE_HOST);
        assert_eq!(overview.default_port, DEFAULT_REMOTE_PORT);
        assert_eq!(overview.pairing_codes[0].code, code.code);
        assert_eq!(overview.clients[0].client_id, issued.client_id);
        assert_eq!(overview.clients[0].client_name, "Overview client");
        assert!(!overview.tailscale.available);

        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

    #[tokio::test]
    async fn publish_server_rolls_back_when_overview_fails() {
        let home = temp_home("bad-overview");
        let path = remote_auth_store_path(&home);
        std::fs::write(&path, b"{bad json").unwrap();
        let state = RemoteHostState::new();
        state.reserve_start().unwrap();
        let server = spawn_remote_http_server(DaemonConfig {
            pickforge_home: home.clone(),
            listener: listener_from_parts("127.0.0.1".into(), free_port()).unwrap(),
        })
        .await
        .unwrap();

        let err = state
            .publish_server_and_overview(home, server)
            .await
            .unwrap_err();

        assert!(err.contains("json error"));
        assert!(matches!(
            &*state.server.lock().unwrap(),
            RemoteHostSlot::Idle
        ));

        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn reserve_start_rejects_overlapping_starts() {
        let state = RemoteHostState::new();

        state.reserve_start().unwrap();

        assert_eq!(
            state.reserve_start().unwrap_err(),
            "remote host listener is already running"
        );
        assert!(matches!(
            &*state.server.lock().unwrap(),
            RemoteHostSlot::Starting
        ));

        state.clear_starting().unwrap();
        assert!(matches!(
            &*state.server.lock().unwrap(),
            RemoteHostSlot::Idle
        ));
    }

    #[test]
    fn listener_from_server_reports_disabled_or_loopback() {
        assert_eq!(listener_from_server(None), DaemonListener::Disabled);

        let info = RemoteHttpServerInfo {
            local_addr: "127.0.0.1:4747".parse::<SocketAddr>().unwrap(),
        };
        assert_eq!(
            listener_from_server(Some(&info)),
            DaemonListener::Loopback {
                host: "127.0.0.1".into(),
                port: 4747,
            }
        );
    }

    #[tokio::test]
    async fn command_helpers_reject_invalid_input_before_shelling_out() {
        let home = temp_home("bad-input");
        let path = remote_auth_store_path(&home);
        assert!(issue_pairing_code_at(&path, 0)
            .unwrap_err()
            .contains("pairing ttl must be positive"));
        assert!(revoke_client_at(&path, "missing")
            .unwrap_err()
            .contains("client was not found"));

        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn client_summary_drops_token_hash_field() {
        let mut store = RemoteAuthStore::default();
        let code = store.issue_pairing_code(1_000, 60_000).unwrap();
        let issued = store
            .exchange_pairing_code(&code.code, "Summary client", 2_000)
            .unwrap();
        let client = store.snapshot().clients.remove(0);
        let summary = RemoteClientSummary::from(client);

        assert_eq!(summary.client_id, issued.client_id);
        assert_eq!(summary.client_name, "Summary client");
        assert_eq!(summary.issued_at_ms, 2_000);
        assert_eq!(summary.last_seen_at_ms, None);
        assert_eq!(summary.revoked_at_ms, None);
    }
}
