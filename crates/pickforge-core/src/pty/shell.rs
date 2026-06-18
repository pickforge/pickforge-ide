//! Resolve which shell to spawn — ported from `shell_invocation.dart`.
//!
//! 1. Honour `$SHELL` when it points at a real executable.
//! 2. Otherwise fall back zsh → bash → sh.
//! 3. On macOS, add `-l` so the login shell sources `~/.profile` etc.

use std::path::Path;

/// A resolved shell program plus the arguments to launch it with.
#[derive(Debug, Clone)]
pub struct ShellInvocation {
    pub program: String,
    pub args: Vec<String>,
}

const FALLBACKS: &[&str] = &["/bin/zsh", "/bin/bash", "/bin/sh"];

pub fn resolve_shell() -> ShellInvocation {
    let program = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.trim().is_empty() && Path::new(s).exists())
        .or_else(|| FALLBACKS.iter().find(|p| Path::new(p).exists()).map(|p| p.to_string()))
        .unwrap_or_else(|| "/bin/sh".to_string());

    // Login flag only on macOS, matching the Flutter app's behaviour.
    let args = if cfg!(target_os = "macos") {
        vec!["-l".to_string()]
    } else {
        Vec::new()
    };

    ShellInvocation { program, args }
}
