use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose, Engine as _};
use pickforge_core::agents::{
    list_agent_skills, AgentChatManager, AgentEvent, AgentProvider, AgentSkill,
    AgentStartOverrides, Engine,
};
use pickforge_core::db::{AgentTimelineEntry, Database};
use tauri::ipc::Channel;
use tauri::State;

use crate::fs_commands::{approved_canonical, ApprovedRoots};

static IMAGE_COUNTER: AtomicU64 = AtomicU64::new(0);
const MAX_STASH_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const STASH_IMAGE_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[tauri::command]
pub fn agent_chat_start(
    mgr: State<'_, AgentChatManager>,
    roots: State<'_, ApprovedRoots>,
    chat_id: String,
    project_root: String,
    provider: String,
    engine: Option<String>,
    model: Option<String>,
    sandbox: Option<String>,
    approval_policy: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
    on_event: Channel<AgentEvent>,
) -> Result<String, String> {
    let provider = provider
        .parse::<AgentProvider>()
        .map_err(|e| e.to_string())?;
    let engine = engine
        .as_deref()
        .unwrap_or("v2")
        .parse::<Engine>()
        .map_err(|e| e.to_string())?;
    let project_root: PathBuf = approved_canonical(&project_root, &roots)?;
    let sink = Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    mgr.start(
        &chat_id,
        project_root,
        provider,
        engine,
        model,
        AgentStartOverrides {
            sandbox,
            approval_policy,
            permission_mode,
            allowed_tools,
        },
        sink,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_send(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
    text: String,
    effort: Option<String>,
    model: Option<String>,
    images: Option<Vec<String>>,
) -> Result<(), String> {
    mgr.send(&session_id, &text, effort, model, images)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_interrupt(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
) -> Result<(), String> {
    mgr.interrupt(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_approve(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
    approval_id: String,
    decision: String,
) -> Result<(), String> {
    mgr.approve(&session_id, &approval_id, &decision)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_steer(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    mgr.steer(&session_id, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_history(
    db: State<'_, Arc<Database>>,
    chat_id: String,
) -> Result<Vec<AgentTimelineEntry>, String> {
    db.agent_timeline_for_chat(&chat_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_skills_list(provider: String) -> Result<Vec<AgentSkill>, String> {
    let provider = provider
        .parse::<AgentProvider>()
        .map_err(|e| e.to_string())?;
    Ok(list_agent_skills(provider))
}

#[tauri::command]
pub fn agent_stash_image(data_base64: String, ext: String) -> Result<String, String> {
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" => {}
        _ => return Err("unsupported image extension".to_string()),
    }

    let encoded = data_base64.trim();
    if decoded_base64_len_upper_bound(encoded) > MAX_STASH_IMAGE_BYTES {
        return Err("image exceeds 10 MB limit".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("invalid base64 image data: {e}"))?;
    if bytes.len() > MAX_STASH_IMAGE_BYTES {
        return Err("image exceeds 10 MB limit".to_string());
    }
    let dir = std::env::temp_dir().join("pickforge-images");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    gc_stale_stashed_images(&dir);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    loop {
        let counter = IMAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!("{millis}-{counter}.{ext}"));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                return path
                    .canonicalize()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn decoded_base64_len_upper_bound(input: &str) -> usize {
    let padding = input
        .as_bytes()
        .iter()
        .rev()
        .take_while(|byte| **byte == b'=')
        .count()
        .min(2);
    let unpadded_len = input.len().saturating_sub(padding);
    let rem = unpadded_len % 4;
    unpadded_len / 4 * 3
        + match rem {
            0 => 0,
            2 => 1,
            3 => 2,
            _ => 3,
        }
}

fn gc_stale_stashed_images(dir: &Path) {
    let now = SystemTime::now();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = now.duration_since(modified) else {
            continue;
        };
        if age > STASH_IMAGE_MAX_AGE {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_stash_image_rejects_decoded_data_over_10mb() {
        let encoded = "A".repeat((MAX_STASH_IMAGE_BYTES / 3 + 1) * 4);
        let error = agent_stash_image(encoded, "png".to_string()).unwrap_err();

        assert_eq!(error, "image exceeds 10 MB limit");
    }
}
