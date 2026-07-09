use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use thiserror::Error;

use crate::process::{run_timeout, RunError};

const PROMPT_MAX_BYTES: usize = 16 * 1024;
const MODEL_MAX_BYTES: usize = 128;
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
const STDERR_TAIL_CHARS: usize = 500;
const OLLAMA_HOST: &str = "127.0.0.1";
const OLLAMA_PORT: u16 = 11434;
const OLLAMA_PATH: &str = "/api/generate";
const MAX_OLLAMA_RESPONSE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawRouteOutput {
    pub output: String,
    pub latency_ms: u64,
    pub exit_ok: bool,
    pub stderr_tail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RouterError {
    #[error("invalid router {field}: {reason}")]
    InvalidInput {
        field: &'static str,
        reason: String,
    },
    #[error("router process failed: {0}")]
    Process(String),
    #[error("router HTTP failed: {0}")]
    Http(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RouterBackend {
    ClaudeCode,
    Codex,
    Ollama,
}

impl RouterBackend {
    fn parse(value: &str) -> Result<Self, RouterError> {
        match value {
            "claudeCode" => Ok(Self::ClaudeCode),
            "codex" => Ok(Self::Codex),
            "ollama" => Ok(Self::Ollama),
            _ => Err(RouterError::InvalidInput {
                field: "backend",
                reason: "must be claudeCode, codex, or ollama".to_string(),
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RouteRequest {
    backend: RouterBackend,
    model: String,
    prompt: String,
    timeout: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RouteCommand {
    program: &'static str,
    args: Vec<String>,
}

impl RouteRequest {
    fn new(
        backend: &str,
        model: &str,
        prompt: &str,
        timeout_ms: Option<u64>,
    ) -> Result<Self, RouterError> {
        let backend = RouterBackend::parse(backend)?;
        validate_model(model)?;
        validate_prompt(prompt)?;
        let timeout_ms = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
        if timeout_ms == 0 || timeout_ms > MAX_TIMEOUT_MS {
            return Err(RouterError::InvalidInput {
                field: "timeout_ms",
                reason: format!("must be between 1 and {MAX_TIMEOUT_MS}"),
            });
        }
        Ok(Self {
            backend,
            model: model.to_string(),
            prompt: prompt.to_string(),
            timeout: Duration::from_millis(timeout_ms),
        })
    }

    fn cli_command(&self) -> Option<RouteCommand> {
        match self.backend {
            RouterBackend::ClaudeCode => Some(RouteCommand {
                program: "claude",
                args: vec![
                    "-p".to_string(),
                    self.prompt.clone(),
                    "--output-format".to_string(),
                    "json".to_string(),
                    "--model".to_string(),
                    self.model.clone(),
                ],
            }),
            RouterBackend::Codex => Some(RouteCommand {
                program: "codex",
                args: vec![
                    "exec".to_string(),
                    "--json".to_string(),
                    "--skip-git-repo-check".to_string(),
                    "-c".to_string(),
                    r#"sandbox_mode="read-only""#.to_string(),
                    "-m".to_string(),
                    self.model.clone(),
                    self.prompt.clone(),
                ],
            }),
            RouterBackend::Ollama => None,
        }
    }
}

pub fn route_raw(
    backend: &str,
    model: &str,
    prompt: &str,
    timeout_ms: Option<u64>,
) -> Result<RawRouteOutput, RouterError> {
    let req = RouteRequest::new(backend, model, prompt, timeout_ms)?;
    match req.backend {
        RouterBackend::ClaudeCode | RouterBackend::Codex => run_cli(&req),
        RouterBackend::Ollama => run_ollama(&req),
    }
}

fn validate_model(model: &str) -> Result<(), RouterError> {
    if model.is_empty() {
        return Err(RouterError::InvalidInput {
            field: "model",
            reason: "must be non-empty".to_string(),
        });
    }
    if model.len() > MODEL_MAX_BYTES {
        return Err(RouterError::InvalidInput {
            field: "model",
            reason: format!("must be at most {MODEL_MAX_BYTES} bytes"),
        });
    }
    let mut chars = model.chars();
    let Some(first) = chars.next() else {
        return Err(RouterError::InvalidInput {
            field: "model",
            reason: "must be non-empty".to_string(),
        });
    };
    if !first.is_ascii_alphanumeric() {
        return Err(RouterError::InvalidInput {
            field: "model",
            reason: "must start with an ASCII letter or digit".to_string(),
        });
    }
    if !model.chars().all(valid_model_char) {
        return Err(RouterError::InvalidInput {
            field: "model",
            reason: "contains unsupported characters".to_string(),
        });
    }
    Ok(())
}

fn valid_model_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/')
}

fn validate_prompt(prompt: &str) -> Result<(), RouterError> {
    if prompt.len() > PROMPT_MAX_BYTES {
        return Err(RouterError::InvalidInput {
            field: "prompt",
            reason: format!("must be at most {PROMPT_MAX_BYTES} bytes"),
        });
    }
    Ok(())
}

fn run_cli(req: &RouteRequest) -> Result<RawRouteOutput, RouterError> {
    let command = req.cli_command().expect("CLI backend has a command");
    let args: Vec<&str> = command.args.iter().map(String::as_str).collect();
    let started = Instant::now();
    let outcome = run_timeout(command.program, &args, None, None, req.timeout)
        .map_err(format_run_error)?;
    Ok(RawRouteOutput {
        output: String::from_utf8_lossy(&outcome.stdout).into_owned(),
        latency_ms: elapsed_ms(started),
        exit_ok: outcome.success(),
        stderr_tail: last_chars(&String::from_utf8_lossy(&outcome.stderr), STDERR_TAIL_CHARS),
    })
}

fn format_run_error(error: RunError) -> RouterError {
    RouterError::Process(error.to_string())
}

fn run_ollama(req: &RouteRequest) -> Result<RawRouteOutput, RouterError> {
    let started = Instant::now();
    let raw = post_ollama(&req.model, &req.prompt, req.timeout)?;
    let (exit_ok, output, stderr_tail) = parse_http_response(&raw)?;
    Ok(RawRouteOutput {
        output,
        latency_ms: elapsed_ms(started),
        exit_ok,
        stderr_tail,
    })
}

fn post_ollama(model: &str, prompt: &str, timeout: Duration) -> Result<Vec<u8>, RouterError> {
    let addr = SocketAddr::from(([127, 0, 0, 1], OLLAMA_PORT));
    let started = Instant::now();
    let mut stream = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| RouterError::Http(format!("connect to {OLLAMA_HOST}:{OLLAMA_PORT}: {e}")))?;
    set_stream_timeout(&stream, remaining(timeout, started))?;
    let request = ollama_http_request(model, prompt)?;
    stream
        .write_all(request.as_bytes())
        .map_err(|e| RouterError::Http(format!("write request: {e}")))?;

    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        set_stream_timeout(&stream, remaining(timeout, started))?;
        let n = stream
            .read(&mut buf)
            .map_err(|e| RouterError::Http(format!("read response: {e}")))?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
        if raw.len() > MAX_OLLAMA_RESPONSE_BYTES {
            return Err(RouterError::Http(format!(
                "response exceeded {MAX_OLLAMA_RESPONSE_BYTES} bytes"
            )));
        }
    }
    Ok(raw)
}

fn set_stream_timeout(stream: &TcpStream, timeout: Duration) -> Result<(), RouterError> {
    if timeout.is_zero() {
        return Err(RouterError::Http("request timed out".to_string()));
    }
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| RouterError::Http(format!("set read timeout: {e}")))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| RouterError::Http(format!("set write timeout: {e}")))?;
    Ok(())
}

fn remaining(timeout: Duration, started: Instant) -> Duration {
    timeout
        .checked_sub(started.elapsed())
        .unwrap_or_else(|| Duration::from_millis(0))
}

fn ollama_http_request(model: &str, prompt: &str) -> Result<String, RouterError> {
    let body = serde_json::to_string(&json!({
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": false,
    }))
    .map_err(|e| RouterError::Http(format!("serialize request: {e}")))?;
    Ok(format!(
        "POST {OLLAMA_PATH} HTTP/1.1\r\nHost: {OLLAMA_HOST}:{OLLAMA_PORT}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ))
}

fn parse_http_response(raw: &[u8]) -> Result<(bool, String, String), RouterError> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| RouterError::Http("no header/body boundary".to_string()))?;
    let status = head.lines().next().unwrap_or("");
    let code = status
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok());
    let exit_ok = matches!(code, Some(200..=299));
    let stderr_tail = if exit_ok {
        String::new()
    } else {
        last_chars(&format!("{status}\n{body}"), STDERR_TAIL_CHARS)
    };
    Ok((exit_ok, body.to_string(), stderr_tail))
}

fn elapsed_ms(started: Instant) -> u64 {
    let ms = started.elapsed().as_millis();
    u64::try_from(ms).unwrap_or(u64::MAX)
}

fn last_chars(value: &str, limit: usize) -> String {
    let mut chars: Vec<char> = value.chars().rev().take(limit).collect();
    chars.reverse();
    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn validates_route_inputs() {
        let big_prompt = "x".repeat(PROMPT_MAX_BYTES + 1);
        let cases = [
            ("openai", "gpt-5.5", "route", Some(1_000), "backend"),
            ("codex", "", "route", Some(1_000), "model"),
            ("codex", "bad model", "route", Some(1_000), "model"),
            ("codex", "-bad", "route", Some(1_000), "model"),
            ("codex", "gpt-5.5", big_prompt.as_str(), Some(1_000), "prompt"),
            ("codex", "gpt-5.5", "route", Some(MAX_TIMEOUT_MS + 1), "timeout_ms"),
        ];

        for (backend, model, prompt, timeout_ms, field) in cases {
            let err = RouteRequest::new(backend, model, prompt, timeout_ms).unwrap_err();
            assert!(
                matches!(err, RouterError::InvalidInput { field: actual, .. } if actual == field),
                "expected {field}, got {err:?}"
            );
        }
    }

    #[test]
    fn builds_claude_argv() {
        let req = RouteRequest::new("claudeCode", "claude-opus-4-8", "open project App", None)
            .unwrap();
        let cmd = req.cli_command().unwrap();
        assert_eq!(cmd.program, "claude");
        assert_eq!(
            cmd.args,
            [
                "-p",
                "open project App",
                "--output-format",
                "json",
                "--model",
                "claude-opus-4-8"
            ]
        );
    }

    #[test]
    fn builds_codex_argv() {
        let req = RouteRequest::new("codex", "gpt-5.5", "open project App", None).unwrap();
        let cmd = req.cli_command().unwrap();
        assert_eq!(cmd.program, "codex");
        assert_eq!(
            cmd.args,
            [
                "exec",
                "--json",
                "--skip-git-repo-check",
                "-c",
                r#"sandbox_mode="read-only""#,
                "-m",
                "gpt-5.5",
                "open project App"
            ]
        );
    }

    #[test]
    fn ollama_has_no_argv() {
        let req = RouteRequest::new("ollama", "qwen2.5:3b", "open project App", None).unwrap();
        assert_eq!(req.cli_command(), None);
    }

    #[test]
    fn serializes_ollama_request_to_fixed_loopback_endpoint() {
        let request = ollama_http_request("qwen2.5:3b", "open project App").unwrap();
        let (head, body) = request.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("POST /api/generate HTTP/1.1\r\n"));
        assert!(head.contains("Host: 127.0.0.1:11434\r\n"));
        assert!(head.contains("Content-Type: application/json\r\n"));
        assert!(head.lines().any(|line| line == "Connection: close"));
        assert!(head.contains(&format!("Content-Length: {}\r\n", body.len())));

        let parsed: Value = serde_json::from_str(body).unwrap();
        assert_eq!(parsed["model"], "qwen2.5:3b");
        assert_eq!(parsed["prompt"], "open project App");
        assert_eq!(parsed["format"], "json");
        assert_eq!(parsed["stream"], false);
    }

    #[test]
    fn parses_http_status_and_body() {
        let (ok, body, stderr) =
            parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        assert!(ok);
        assert_eq!(body, "{}");
        assert!(stderr.is_empty());

        let (ok, body, stderr) = parse_http_response(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 4\r\n\r\nnope",
        )
        .unwrap();
        assert!(!ok);
        assert_eq!(body, "nope");
        assert!(stderr.contains("500"));
        assert!(stderr.contains("nope"));
    }
}
