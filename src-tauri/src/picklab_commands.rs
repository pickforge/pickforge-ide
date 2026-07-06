use std::time::Duration;

use pickforge_core::{run_timeout, which_in};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickLabStatus {
    pub cli_available: bool,
    pub mcp_available: bool,
    pub cli_path: Option<String>,
    pub mcp_path: Option<String>,
    pub version: Option<String>,
    pub doctor: Option<Value>,
    pub agents: Option<Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn picklab_status() -> Result<PickLabStatus, String> {
    tauri::async_runtime::spawn_blocking(load_picklab_status)
        .await
        .map_err(|e| e.to_string())?
}

fn load_picklab_status() -> Result<PickLabStatus, String> {
    let env = pickforge_core::user_shell_environment();
    let cli_path = which_in("picklab", env).map(|path| path.to_string_lossy().into_owned());
    let mcp_path = which_in("picklab-mcp", env).map(|path| path.to_string_lossy().into_owned());
    let cli_available = cli_path.is_some();
    let mcp_available = mcp_path.is_some();

    if !cli_available {
        return Ok(PickLabStatus {
            cli_available,
            mcp_available,
            cli_path,
            mcp_path,
            version: None,
            doctor: None,
            agents: None,
            error: None,
        });
    }

    let version = run_text("picklab", &["--version"]).ok();
    let doctor = run_json("picklab", &["doctor", "--json"]).ok();
    let agents = run_json("picklab", &["agents", "list", "--json"]).ok();

    Ok(PickLabStatus {
        cli_available,
        mcp_available,
        cli_path,
        mcp_path,
        version,
        doctor,
        agents,
        error: None,
    })
}

fn run_text(program: &str, args: &[&str]) -> Result<String, String> {
    let out = run_timeout(program, args, None, None, Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    if !out.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(out.stdout_utf8().trim().to_string())
}

fn run_json(program: &str, args: &[&str]) -> Result<Value, String> {
    let text = run_text(program, args)?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
