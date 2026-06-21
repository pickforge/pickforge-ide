//! Chrome DevTools Protocol commands for the web inspector (async — the client
//! speaks WebSocket JSON-RPC). Discovers a running dev server's debugger,
//! attaches, dumps the DOM, and maps a generated position back to authored
//! source via the Source Map v3 decoder. The whole flow is best-effort: a target
//! that isn't reachable surfaces an honest error the UI renders as an empty
//! state, never a crash.

use pickforge_core::{decode_dom_node, CdpClient, CdpTarget, DomNode, SourceMap, SourceMapping};
use serde_json::json;
use tauri::State;

/// Discover the debuggable page targets on a dev server's debugger host:port
/// (`http://<host>:<port>/json`). Returns the attachable pages; an empty list /
/// connection error means "no dev server reachable".
#[tauri::command]
pub async fn cdp_discover(host: String, port: u16) -> Result<Vec<CdpTarget>, String> {
    CdpClient::discover(&host, port)
        .await
        .map_err(|e| e.to_string())
}

/// Attach to a target by its `webSocketDebuggerUrl` (from [`cdp_discover`]).
#[tauri::command]
pub async fn cdp_attach(client: State<'_, CdpClient>, ws_url: String) -> Result<(), String> {
    client.attach(&ws_url).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cdp_detach(client: State<'_, CdpClient>) -> Result<(), String> {
    client.detach().await;
    Ok(())
}

#[tauri::command]
pub async fn cdp_status(client: State<'_, CdpClient>) -> Result<Option<String>, String> {
    Ok(client.current_url().await)
}

/// The page's DOM as a compact tree (`DOM.getDocument` at full depth, piercing
/// shadow roots). Enables the DOM domain first (a fresh target may not have it
/// on). `None` if the page has no document yet (not loaded / detached) or its
/// root holds no decodable element — the UI renders that as an honest empty
/// state, never a panic or a bogus tree.
#[tauri::command]
pub async fn cdp_dom_tree(client: State<'_, CdpClient>) -> Result<Option<DomNode>, String> {
    // Best-effort enable; ignore the result (already-enabled is not an error we
    // need to surface).
    let _ = client.call("DOM.enable", json!({})).await;
    let result = client
        .call("DOM.getDocument", json!({ "depth": -1, "pierce": true }))
        .await
        .map_err(|e| e.to_string())?;
    // A well-formed reply carries the `#document` root under `root`. An absent
    // root (e.g. the page hasn't committed a document) is an empty state, not a
    // reason to decode the RPC envelope as if it were a node.
    let Some(root) = result.get("root") else {
        return Ok(None);
    };
    Ok(decode_dom_node(root))
}

/// Map a generated `line`/`column` (zero-based) in a script to its authored
/// source position, given the script's source map JSON. Thin wrapper over the
/// Source Map v3 decoder so the renderer never parses VLQ. `None` when the
/// position is unmapped or the map is malformed.
#[tauri::command]
pub fn cdp_map_source(
    map_json: String,
    line: i64,
    column: i64,
) -> Result<Option<SourceMapping>, String> {
    let Some(map) = SourceMap::parse(&map_json) else {
        return Ok(None);
    };
    Ok(map.original_position_for(line, column).map(|m| SourceMapping {
        source: map.resolve_source(&m.source),
        ..m
    }))
}

/// Fetch a script's `.map` from the dev server over plain HTTP so
/// [`cdp_map_source`] can resolve it. Best-effort — an unreachable / non-2xx map
/// returns an error the UI treats as "no exact source".
#[tauri::command]
pub async fn cdp_fetch_source_map(
    host: String,
    port: u16,
    map_path: String,
) -> Result<String, String> {
    CdpClient::fetch_text(&host, port, &map_path)
        .await
        .map_err(|e| e.to_string())
}
