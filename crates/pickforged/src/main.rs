use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use pickforge_core::{DaemonConfig, RemoteHostDaemon};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("pickforged: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("pickforged [--status-json]");
        return Ok(());
    }

    let config = DaemonConfig::from_env(None).map_err(|err| err.to_string())?;
    let daemon = RemoteHostDaemon::new(config).map_err(|err| err.to_string())?;

    if args.iter().any(|arg| arg == "--status-json") {
        let status = daemon.status(now_ms());
        let json = serde_json::to_string_pretty(&status).map_err(|err| err.to_string())?;
        println!("{json}");
        return Ok(());
    }

    println!(
        "pickforged remote host foundation is installed; no listener is enabled in this slice"
    );
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}
