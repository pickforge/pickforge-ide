use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

const PAIRING_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TOKEN_BYTES: usize = 32;
const CLIENT_ID_BYTES: usize = 16;
const TOKEN_HASH_DOMAIN: &[u8] = b"pickforge-remote-token-v1";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RemoteAuthError {
    #[error("pairing ttl must be positive")]
    InvalidPairingTtl,
    #[error("pairing code was not found")]
    PairingCodeNotFound,
    #[error("pairing code has expired")]
    PairingCodeExpired,
    #[error("pairing code was already used")]
    PairingCodeUsed,
    #[error("client name is required")]
    ClientNameRequired,
    #[error("client was not found")]
    ClientNotFound,
    #[error("client token is invalid")]
    InvalidToken,
    #[error("client token has been revoked")]
    ClientRevoked,
    #[error("remote auth store io error: {0}")]
    Io(String),
    #[error("remote auth store json error: {0}")]
    Json(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingCode {
    pub code: String,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub used_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientTokenRecord {
    pub client_id: String,
    pub client_name: String,
    pub token_hash: String,
    pub issued_at_ms: i64,
    pub last_seen_at_ms: Option<i64>,
    pub revoked_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedClientToken {
    pub client_id: String,
    pub client_name: String,
    pub token: String,
    pub issued_at_ms: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAuthStoreSnapshot {
    pub pairing_codes: Vec<PairingCode>,
    pub clients: Vec<ClientTokenRecord>,
}

#[derive(Debug, Clone, Default)]
pub struct RemoteAuthStore {
    snapshot: RemoteAuthStoreSnapshot,
}

impl RemoteAuthStore {
    pub fn snapshot_from_path(path: &Path) -> Result<RemoteAuthStoreSnapshot, RemoteAuthError> {
        let _guard = lock_auth_path(path)?;
        Self::load_from_path(path).map(|store| store.snapshot())
    }

    pub fn update_path<T>(
        path: &Path,
        update: impl FnOnce(&mut RemoteAuthStore) -> Result<T, RemoteAuthError>,
    ) -> Result<T, RemoteAuthError> {
        let _guard = lock_auth_path(path)?;
        let mut store = Self::load_from_path(path)?;
        let value = update(&mut store)?;
        store.save_to_path(path)?;
        Ok(value)
    }

    pub fn load_from_path(path: &Path) -> Result<Self, RemoteAuthError> {
        match std::fs::read_to_string(path) {
            Ok(raw) => {
                let snapshot = serde_json::from_str::<RemoteAuthStoreSnapshot>(&raw)
                    .map_err(|err| RemoteAuthError::Json(err.to_string()))?;
                Ok(Self::from_snapshot(snapshot))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(err) => Err(RemoteAuthError::Io(err.to_string())),
        }
    }

    pub fn save_to_path(&self, path: &Path) -> Result<(), RemoteAuthError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| RemoteAuthError::Io(err.to_string()))?;
        }
        let raw = serde_json::to_vec_pretty(&self.snapshot)
            .map_err(|err| RemoteAuthError::Json(err.to_string()))?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let tmp = path.with_extension(format!("json.tmp-{}-{nonce}", std::process::id()));
        write_private_file(&tmp, &raw)?;
        std::fs::rename(&tmp, path).map_err(|err| RemoteAuthError::Io(err.to_string()))?;
        set_private_permissions(path)?;
        Ok(())
    }

    pub fn from_snapshot(snapshot: RemoteAuthStoreSnapshot) -> Self {
        Self { snapshot }
    }

    pub fn snapshot(&self) -> RemoteAuthStoreSnapshot {
        self.snapshot.clone()
    }

    pub fn issue_pairing_code(
        &mut self,
        now_ms: i64,
        ttl_ms: i64,
    ) -> Result<PairingCode, RemoteAuthError> {
        if ttl_ms <= 0 {
            return Err(RemoteAuthError::InvalidPairingTtl);
        }
        let expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .ok_or(RemoteAuthError::InvalidPairingTtl)?;
        let code = PairingCode {
            code: grouped_pairing_code(),
            created_at_ms: now_ms,
            expires_at_ms,
            used_at_ms: None,
        };
        self.snapshot.pairing_codes.push(code.clone());
        Ok(code)
    }

    pub fn exchange_pairing_code(
        &mut self,
        pairing_code: &str,
        client_name: &str,
        now_ms: i64,
    ) -> Result<IssuedClientToken, RemoteAuthError> {
        let client_name = clean_client_name(client_name)?;
        let normalized = normalize_pairing_code(pairing_code);
        let pairing = self
            .snapshot
            .pairing_codes
            .iter_mut()
            .find(|code| normalize_pairing_code(&code.code) == normalized)
            .ok_or(RemoteAuthError::PairingCodeNotFound)?;

        if pairing.used_at_ms.is_some() {
            return Err(RemoteAuthError::PairingCodeUsed);
        }
        if now_ms >= pairing.expires_at_ms {
            return Err(RemoteAuthError::PairingCodeExpired);
        }

        let client_id = random_hex(CLIENT_ID_BYTES);
        let token = format!("pfh_{}", random_hex(TOKEN_BYTES));
        let issued = IssuedClientToken {
            client_id: client_id.clone(),
            client_name: client_name.clone(),
            token: token.clone(),
            issued_at_ms: now_ms,
        };

        pairing.used_at_ms = Some(now_ms);
        self.snapshot.clients.push(ClientTokenRecord {
            client_id,
            client_name,
            token_hash: token_hash(&token),
            issued_at_ms: now_ms,
            last_seen_at_ms: None,
            revoked_at_ms: None,
        });
        Ok(issued)
    }

    pub fn authenticate(
        &mut self,
        client_id: &str,
        token: &str,
        now_ms: i64,
    ) -> Result<ClientTokenRecord, RemoteAuthError> {
        let client = self
            .snapshot
            .clients
            .iter_mut()
            .find(|client| client.client_id == client_id)
            .ok_or(RemoteAuthError::ClientNotFound)?;
        if client.revoked_at_ms.is_some() {
            return Err(RemoteAuthError::ClientRevoked);
        }
        if !constant_time_eq(&client.token_hash, &token_hash(token)) {
            return Err(RemoteAuthError::InvalidToken);
        }
        client.last_seen_at_ms = Some(now_ms);
        Ok(client.clone())
    }

    pub fn revoke_client(&mut self, client_id: &str, now_ms: i64) -> Result<(), RemoteAuthError> {
        let client = self
            .snapshot
            .clients
            .iter_mut()
            .find(|client| client.client_id == client_id)
            .ok_or(RemoteAuthError::ClientNotFound)?;
        if client.revoked_at_ms.is_none() {
            client.revoked_at_ms = Some(now_ms);
        }
        Ok(())
    }
}

pub fn remote_auth_store_path(pickforge_home: &str) -> PathBuf {
    Path::new(pickforge_home).join("remote-auth.json")
}

fn clean_client_name(client_name: &str) -> Result<String, RemoteAuthError> {
    let trimmed = client_name.trim();
    if trimmed.is_empty() {
        return Err(RemoteAuthError::ClientNameRequired);
    }
    Ok(trimmed.chars().take(80).collect())
}

fn normalize_pairing_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_uppercase())
        .collect()
}

fn grouped_pairing_code() -> String {
    let raw = random_from_alphabet(PAIRING_ALPHABET, 16);
    raw.as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

fn random_from_alphabet(alphabet: &[u8], len: usize) -> String {
    let mut out = String::with_capacity(len);
    let zone = u8::MAX - (u8::MAX % alphabet.len() as u8);
    while out.len() < len {
        let mut byte = [0_u8; 1];
        OsRng.fill_bytes(&mut byte);
        if byte[0] < zone {
            out.push(alphabet[(byte[0] as usize) % alphabet.len()] as char);
        }
    }
    out
}

fn random_hex(bytes_len: usize) -> String {
    let mut bytes = vec![0_u8; bytes_len];
    OsRng.fill_bytes(&mut bytes);
    hex_lower(&bytes)
}

fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(TOKEN_HASH_DOMAIN);
    hasher.update(token.as_bytes());
    hex_lower(&hasher.finalize())
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let len = left.len().max(right.len());
    let mut diff = left.len() ^ right.len();
    for i in 0..len {
        let a = left.get(i).copied().unwrap_or(0);
        let b = right.get(i).copied().unwrap_or(0);
        diff |= (a ^ b) as usize;
    }
    diff == 0
}

struct RemoteAuthPathLock {
    #[cfg(unix)]
    file: std::fs::File,
}

fn lock_auth_path(path: &Path) -> Result<RemoteAuthPathLock, RemoteAuthError> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;

        let lock_path = path.with_extension("json.lock");
        if let Some(parent) = lock_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| RemoteAuthError::Io(err.to_string()))?;
        }
        let file = open_private_file(&lock_path, false)?;
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
        if rc != 0 {
            return Err(RemoteAuthError::Io(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        Ok(RemoteAuthPathLock { file })
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(RemoteAuthPathLock {})
    }
}

#[cfg(unix)]
impl Drop for RemoteAuthPathLock {
    fn drop(&mut self) {
        use std::os::fd::AsRawFd;

        let _ = unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
    }
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), RemoteAuthError> {
    let mut file = open_private_file(path, true)?;
    file.write_all(bytes)
        .map_err(|err| RemoteAuthError::Io(err.to_string()))?;
    file.sync_all()
        .map_err(|err| RemoteAuthError::Io(err.to_string()))?;
    set_private_permissions(path)?;
    Ok(())
}

fn open_private_file(path: &Path, create_new: bool) -> Result<std::fs::File, RemoteAuthError> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    if create_new {
        options.create_new(true).truncate(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;

        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|err| RemoteAuthError::Io(err.to_string()))?;
    set_private_permissions(path)?;
    Ok(file)
}

fn set_private_permissions(path: &Path) -> Result<(), RemoteAuthError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, permissions)
            .map_err(|err| RemoteAuthError::Io(err.to_string()))?;
    }
    let _ = path;
    Ok(())
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_code_issues_grouped_expiring_code() {
        let mut store = RemoteAuthStore::default();
        let code = store.issue_pairing_code(1_000, 60_000).unwrap();
        assert_eq!(code.code.len(), 19);
        assert_eq!(code.code.chars().filter(|c| *c == '-').count(), 3);
        assert_eq!(code.expires_at_ms, 61_000);
        assert!(code.used_at_ms.is_none());
    }

    #[test]
    fn pairing_exchange_issues_client_token_and_hashes_storage() {
        let mut store = RemoteAuthStore::default();
        let code = store.issue_pairing_code(1_000, 60_000).unwrap();
        let compact = code.code.replace('-', "").to_lowercase();

        let issued = store
            .exchange_pairing_code(&compact, "  MacBook Pro  ", 2_000)
            .unwrap();

        assert_eq!(issued.client_name, "MacBook Pro");
        assert!(issued.token.starts_with("pfh_"));
        let snapshot = store.snapshot();
        assert_eq!(snapshot.clients.len(), 1);
        assert_ne!(snapshot.clients[0].token_hash, issued.token);
        assert_eq!(snapshot.pairing_codes[0].used_at_ms, Some(2_000));
    }

    #[test]
    fn pairing_code_cannot_be_reused_or_exchanged_after_expiry() {
        let mut store = RemoteAuthStore::default();
        let used = store.issue_pairing_code(1_000, 60_000).unwrap();
        store
            .exchange_pairing_code(&used.code, "client", 2_000)
            .unwrap();
        assert_eq!(
            store.exchange_pairing_code(&used.code, "other", 3_000),
            Err(RemoteAuthError::PairingCodeUsed)
        );

        let expired = store.issue_pairing_code(4_000, 10).unwrap();
        assert_eq!(
            store.exchange_pairing_code(&expired.code, "client", 4_010),
            Err(RemoteAuthError::PairingCodeExpired)
        );
    }

    #[test]
    fn authenticate_updates_last_seen_and_revoke_blocks_later_use() {
        let mut store = RemoteAuthStore::default();
        let code = store.issue_pairing_code(1_000, 60_000).unwrap();
        let issued = store
            .exchange_pairing_code(&code.code, "client", 2_000)
            .unwrap();

        let authed = store
            .authenticate(&issued.client_id, &issued.token, 3_000)
            .unwrap();
        assert_eq!(authed.last_seen_at_ms, Some(3_000));

        store.revoke_client(&issued.client_id, 4_000).unwrap();
        assert_eq!(
            store.authenticate(&issued.client_id, &issued.token, 5_000),
            Err(RemoteAuthError::ClientRevoked)
        );
    }

    #[test]
    fn wrong_token_is_rejected() {
        let mut store = RemoteAuthStore::default();
        let code = store.issue_pairing_code(1_000, 60_000).unwrap();
        let issued = store
            .exchange_pairing_code(&code.code, "client", 2_000)
            .unwrap();

        assert_eq!(
            store.authenticate(&issued.client_id, "pfh_bad", 3_000),
            Err(RemoteAuthError::InvalidToken)
        );
    }

    #[test]
    fn store_persists_hashes_without_plain_tokens() {
        let path = std::env::temp_dir().join(format!(
            "pickforge-remote-auth-{}-{}.json",
            std::process::id(),
            random_hex(4)
        ));
        let mut store = RemoteAuthStore::default();
        let code = store.issue_pairing_code(1_000, 60_000).unwrap();
        let issued = store
            .exchange_pairing_code(&code.code, "client", 2_000)
            .unwrap();

        store.save_to_path(&path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains(&issued.token));

        let mut loaded = RemoteAuthStore::load_from_path(&path).unwrap();
        assert!(loaded
            .authenticate(&issued.client_id, &issued.token, 3_000)
            .is_ok());
        std::fs::remove_file(path).ok();
    }

    #[test]
    #[cfg(unix)]
    fn store_writes_temp_and_final_files_private() {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!(
            "pickforge-remote-auth-private-{}-{}.json",
            std::process::id(),
            random_hex(4)
        ));
        let mut store = RemoteAuthStore::default();
        store.issue_pairing_code(1_000, 60_000).unwrap();
        store.save_to_path(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn update_path_serializes_load_mutate_save() {
        let path = std::env::temp_dir().join(format!(
            "pickforge-remote-auth-update-{}-{}.json",
            std::process::id(),
            random_hex(4)
        ));
        let code =
            RemoteAuthStore::update_path(&path, |store| store.issue_pairing_code(1_000, 60_000))
                .unwrap();
        let snapshot = RemoteAuthStore::snapshot_from_path(&path).unwrap();
        assert_eq!(snapshot.pairing_codes[0].code, code.code);
        std::fs::remove_file(path.with_extension("json.lock")).ok();
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn constant_time_compare_checks_full_length() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abc0"));
    }
}
