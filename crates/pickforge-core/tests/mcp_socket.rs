//! End-to-end check of the MCP endpoint over a real Unix socket: bind a
//! listener that serves `pickforge_core::mcp::handle_line` against a scripted
//! `LiveState`, connect a client, and drive the actual agent handshake
//! (`initialize` → `tools/list` → `tools/call`). This exercises the same wire
//! path the in-app server and the stdio adapter use, without a GUI or a device.

#![cfg(unix)]

use std::path::PathBuf;

use pickforge_core::mcp::{
    ActiveTarget, InspectorKind, LiveState, ProjectContext, PROTOCOL_VERSION,
};
use pickforge_core::targets::Capability;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

/// A scripted live state: a Flutter target with a selection, used to prove the
/// adapter routing and capability gating travel across the socket intact.
struct TestLive;

impl LiveState for TestLive {
    fn active_target(&self) -> Option<ActiveTarget> {
        Some(ActiveTarget {
            id: "flutter".into(),
            label: "Flutter".into(),
            capabilities: vec![
                Capability::InspectSelection,
                Capability::CaptureScreenshot,
                Capability::StreamLogs,
            ],
            inspector_kind: InspectorKind::VmService,
        })
    }
    fn project_context(&self) -> ProjectContext {
        ProjectContext {
            project_root: Some("/abs/proj".into()),
            context_dir: Some("/abs/proj/.pickforge".into()),
            runs_dir: Some("/abs/proj/.pickforge/runs".into()),
            chats_dir: Some("/abs/proj/.pickforge/chats".into()),
            support_tier: "deep".into(),
        }
    }
    fn flutter_selection(&self) -> Result<Option<Value>, String> {
        Ok(Some(json!({ "className": "ElevatedButton", "id": "w-1" })))
    }
    fn uiautomator_selection(&self) -> Result<Option<Value>, String> {
        Ok(None)
    }
    fn capture_screenshot(&self) -> Result<Option<String>, String> {
        Ok(Some("/abs/proj/.pickforge/shot.png".into()))
    }
    fn run_logs(&self, limit: usize) -> Vec<String> {
        (0..limit.min(3)).map(|i| format!("log {i}")).collect()
    }
}

fn socket_path() -> PathBuf {
    std::env::temp_dir().join(format!("pf-mcp-e2e-{}.sock", std::process::id()))
}

/// Serve exactly one connection, framing newline-delimited JSON-RPC through the
/// core handler — the same dispatch the in-app server uses.
async fn serve_one(listener: UnixListener) {
    if let Ok((stream, _)) = listener.accept().await {
        let (rx, mut tx) = stream.into_split();
        let mut lines = BufReader::new(rx).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(mut reply) = pickforge_core::mcp::handle_line(&TestLive, &line) {
                reply.push('\n');
                if tx.write_all(reply.as_bytes()).await.is_err() {
                    break;
                }
                let _ = tx.flush().await;
            }
        }
    }
}

#[tokio::test]
async fn agent_handshake_over_the_socket() {
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).expect("bind unix socket");
    let server = tokio::spawn(serve_one(listener));

    let client = UnixStream::connect(&path).await.expect("connect");
    let (rx, mut tx) = client.into_split();
    let mut reader = BufReader::new(rx).lines();

    // Helper: send one request line, read one response line, parse it.
    async fn round_trip(
        tx: &mut (impl AsyncWriteExt + Unpin),
        reader: &mut tokio::io::Lines<impl AsyncBufReadExt + Unpin>,
        req: Value,
    ) -> Value {
        let mut line = serde_json::to_string(&req).unwrap();
        line.push('\n');
        tx.write_all(line.as_bytes()).await.unwrap();
        tx.flush().await.unwrap();
        let resp = reader.next_line().await.unwrap().expect("a response line");
        serde_json::from_str(&resp).unwrap()
    }

    // 1. initialize
    let init = round_trip(
        &mut tx,
        &mut reader,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
    )
    .await;
    assert_eq!(init["id"], json!(1));
    assert_eq!(init["result"]["protocolVersion"], json!(PROTOCOL_VERSION));
    assert_eq!(init["result"]["serverInfo"]["name"], json!("pickforge"));

    // 2. tools/list — the four tools, each with an input schema.
    let list = round_trip(
        &mut tx,
        &mut reader,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
    )
    .await;
    let tools = list["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 4);
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"get_current_selection"));
    assert!(names.contains(&"capture_screenshot"));
    assert!(names.contains(&"get_run_logs"));
    assert!(names.contains(&"get_project_context"));

    // 3. tools/call get_current_selection — routes to the Flutter adapter.
    let call = round_trip(
        &mut tx,
        &mut reader,
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "get_current_selection", "arguments": {} }
        }),
    )
    .await;
    assert_eq!(call["result"]["isError"], json!(false));
    let text = call["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("flutterWidget"), "got: {text}");
    assert!(text.contains("ElevatedButton"), "got: {text}");

    drop(tx);
    drop(reader);
    let _ = server.await;
    let _ = std::fs::remove_file(&path);
}
