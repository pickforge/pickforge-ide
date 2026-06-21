//! `pickforge-mcp` — the stdio MCP adapter the embedded agent spawns.
//!
//! It is a thin transport bridge, NOT an MCP implementation: the running
//! PickForge app owns the MCP protocol surface and serves it as newline-delimited
//! JSON-RPC over a local Unix socket. This adapter resolves that socket from the
//! `PICKFORGE_*` env the embedded terminal already carries, connects, and pumps
//! frames in both directions (stdin → socket, socket → stdout). Keeping the
//! protocol in one place (the app) means the adapter never drifts from it.
//!
//! Discovery precedence (per docs/architecture/pickforge-mcp.md):
//!   1. `PICKFORGE_IPC_ENDPOINT`  — the live socket path, used directly.
//!   2. `PICKFORGE_CONTEXT_DIR`   — read `<dir>/ipc.sock-path`.
//!   3. legacy `.pickforge/ipc.sock-path` under `PICKFORGE_PROJECT_ROOT` / cwd.
//!
//! Local-only: the only thing it ever connects to is a Unix domain socket on the
//! same machine. There is no network code here.

use std::process::ExitCode;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[cfg(unix)]
use tokio::net::UnixStream;

fn main() -> ExitCode {
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("pickforge-mcp: failed to start runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    match rt.block_on(run()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("pickforge-mcp: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(unix)]
async fn run() -> Result<(), String> {
    let endpoint = resolve_endpoint()
        .ok_or_else(|| "no PickForge IPC endpoint found — start a run in PickForge first \
                        (looked at PICKFORGE_IPC_ENDPOINT, PICKFORGE_CONTEXT_DIR/ipc.sock-path, \
                        and .pickforge/ipc.sock-path)".to_string())?;

    let stream = UnixStream::connect(&endpoint)
        .await
        .map_err(|e| format!("cannot connect to PickForge at {endpoint}: {e}"))?;
    let (sock_rx, mut sock_tx) = stream.into_split();

    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut from_agent = BufReader::new(stdin).lines();
    let mut from_app = BufReader::new(sock_rx).lines();

    // Bidirectional newline-delimited pump. Either side closing ends the bridge.
    loop {
        tokio::select! {
            line = from_agent.next_line() => match line {
                Ok(Some(mut l)) => {
                    l.push('\n');
                    if sock_tx.write_all(l.as_bytes()).await.is_err() {
                        break;
                    }
                }
                _ => break, // agent closed stdin
            },
            line = from_app.next_line() => match line {
                Ok(Some(mut l)) => {
                    l.push('\n');
                    if stdout.write_all(l.as_bytes()).await.is_err() {
                        break;
                    }
                    let _ = stdout.flush().await;
                }
                _ => break, // app closed the socket
            },
        }
    }
    Ok(())
}

#[cfg(not(unix))]
async fn run() -> Result<(), String> {
    // Windows named-pipe transport is intentionally deferred (see the issue's
    // "deliberately minimal" notes). PickForge desktop targets Linux/macOS first.
    Err("pickforge-mcp currently supports Unix sockets only".to_string())
}

/// Resolve the live socket path from the `PICKFORGE_*` env, in precedence order.
#[cfg(unix)]
fn resolve_endpoint() -> Option<String> {
    if let Some(ep) = trimmed(std::env::var("PICKFORGE_IPC_ENDPOINT").ok()) {
        return Some(ep);
    }
    if let Some(dir) = trimmed(std::env::var("PICKFORGE_CONTEXT_DIR").ok()) {
        if let Some(p) = read_sock_path(&format!("{dir}/ipc.sock-path")) {
            return Some(p);
        }
    }
    // Legacy: project-local `.pickforge/ipc.sock-path`.
    let root = trimmed(std::env::var("PICKFORGE_PROJECT_ROOT").ok())
        .or_else(|| std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned()))?;
    read_sock_path(&format!("{root}/.pickforge/ipc.sock-path"))
}

#[cfg(unix)]
fn read_sock_path(file: &str) -> Option<String> {
    trimmed(std::fs::read_to_string(file).ok())
}

fn trimmed(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
