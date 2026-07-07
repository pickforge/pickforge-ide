use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use pickforge_core::{
    parse_listener, remote_auth_store_path, spawn_remote_http_server, tailscale_serve_disable,
    tailscale_serve_enable, tailscale_ssh_set, tailscale_status, DaemonConfig, DaemonListener,
    RemoteAuthStore, RemoteHostDaemon,
};
use serde_json::json;

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
        "tailscale-serve" => tailscale_serve(&args[1..]),
        "tailscale-serve-off" => tailscale_serve_off(&args[1..]),
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
  tailscale-serve --listen 127.0.0.1:4747 [--https-port 443]
  tailscale-serve-off [--https-port 443]
  tailscale-ssh-on
  tailscale-ssh-off"
    );
}

fn print_status() -> Result<(), String> {
    let config = DaemonConfig::from_env(None).map_err(|err| err.to_string())?;
    let daemon = RemoteHostDaemon::new(config).map_err(|err| err.to_string())?;
    print_json(&daemon.status(now_ms()))
}

async fn serve(args: &[String]) -> Result<(), String> {
    let listener = listener_arg(args)?.ok_or("missing --listen <loopback-host:port>")?;
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    let server = spawn_remote_http_server(DaemonConfig {
        pickforge_home: home,
        listener,
    })
    .await
    .map_err(|err| err.to_string())?;
    println!(
        "pickforged listening on http://{}",
        server.info().local_addr
    );
    std::future::pending::<()>().await;
    #[allow(unreachable_code)]
    Ok(())
}

fn issue_pairing_code(args: &[String]) -> Result<(), String> {
    let ttl_ms = numeric_arg(args, "--ttl-ms")?.unwrap_or(10 * 60 * 1000);
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    let path = remote_auth_store_path(&home);
    let mut store = RemoteAuthStore::load_from_path(&path).map_err(|err| err.to_string())?;
    let code = store
        .issue_pairing_code(now_ms(), ttl_ms)
        .map_err(|err| err.to_string())?;
    store.save_to_path(&path).map_err(|err| err.to_string())?;
    print_json(&code)
}

fn print_clients() -> Result<(), String> {
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    let path = remote_auth_store_path(&home);
    let store = RemoteAuthStore::load_from_path(&path).map_err(|err| err.to_string())?;
    let snapshot = store.snapshot();
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
    print_json(&json!({ "clients": clients }))
}

fn revoke_client(args: &[String]) -> Result<(), String> {
    let client_id = args.first().ok_or("missing client id")?;
    let home = pickforge_core::pickforge_home(None).map_err(|err| err.to_string())?;
    let path = remote_auth_store_path(&home);
    let mut store = RemoteAuthStore::load_from_path(&path).map_err(|err| err.to_string())?;
    store
        .revoke_client(client_id, now_ms())
        .map_err(|err| err.to_string())?;
    store.save_to_path(&path).map_err(|err| err.to_string())?;
    print_json(&json!({ "clientId": client_id, "revoked": true }))
}

fn tailscale_serve(args: &[String]) -> Result<(), String> {
    let listener = listener_arg(args)?.ok_or("missing --listen <loopback-host:port>")?;
    let https_port = port_arg(args, "--https-port")?.unwrap_or(443);
    print_json(&tailscale_serve_enable(&listener, https_port)?)
}

fn tailscale_serve_off(args: &[String]) -> Result<(), String> {
    let https_port = port_arg(args, "--https-port")?.unwrap_or(443);
    print_json(&tailscale_serve_disable(https_port)?)
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

fn port_arg(args: &[String], name: &str) -> Result<Option<u16>, String> {
    let Some(raw) = numeric_arg(args, name)? else {
        return Ok(None);
    };
    if !(1..=u16::MAX as i64).contains(&raw) {
        return Err(format!("{name} must be 1-65535"));
    }
    Ok(Some(raw as u16))
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
