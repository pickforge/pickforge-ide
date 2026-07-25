use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use pickforge_core::{
    voice_availability, SpeakEvent, SpeechSessionManager, VoiceAvailability, VoiceEvent,
    VoiceSessionManager, VoiceStartRequest,
};
use tauri::ipc::Channel;
use tauri::State;

const STOP_TIMEOUT: Duration = Duration::from_secs(20);

#[tauri::command]
pub async fn voice_start(
    manager: State<'_, Arc<VoiceSessionManager>>,
    language: Option<String>,
    model_path_override: Option<String>,
    on_event: Channel<VoiceEvent>,
) -> Result<String, String> {
    let manager = Arc::clone(manager.inner());
    let model_path_override = model_path_override
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .start(
                VoiceStartRequest::new(language, model_path_override),
                move |event| {
                    let _ = on_event.send(event);
                },
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn voice_stop(
    manager: State<'_, Arc<VoiceSessionManager>>,
    session_id: String,
) -> Result<String, String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .stop(&session_id, STOP_TIMEOUT)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn voice_cancel(
    manager: State<'_, Arc<VoiceSessionManager>>,
    session_id: String,
) -> Result<(), String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.cancel(&session_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn voice_status(
    model_path_override: Option<String>,
) -> Result<VoiceAvailability, String> {
    let model_path_override = model_path_override
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || {
        voice_availability(model_path_override.as_deref())
    })
    .await
    .map_err(|error| error.to_string())
}

/// Ember talk-back: speak `text` via local OS TTS. Mirrors `voice_start`'s
/// shape — spawns in the background and returns a session id immediately;
/// `on_event` carries started/finished/error as the utterance settles.
#[tauri::command]
pub async fn voice_speak(
    manager: State<'_, Arc<SpeechSessionManager>>,
    text: String,
    on_event: Channel<SpeakEvent>,
) -> Result<String, String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .speak(&text, move |event: SpeakEvent| {
                let _ = on_event.send(event);
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Barge-in: hard-kill an in-flight utterance. Idempotent — cancelling an
/// already-finished or unknown session is not an error.
#[tauri::command]
pub async fn voice_speak_cancel(
    manager: State<'_, Arc<SpeechSessionManager>>,
    session_id: String,
) -> Result<(), String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .cancel(&session_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
