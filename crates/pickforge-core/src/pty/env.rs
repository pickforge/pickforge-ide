//! PTY environment normalisation — ported from `pty_environment.dart`.
//!
//! Strip anything that suppresses colour and force a truecolor-capable `TERM`
//! so agents (Claude/Codex) render with their real palettes.

use std::collections::HashMap;

pub fn normalize_pty_env(mut env: HashMap<String, String>) -> HashMap<String, String> {
    env.remove("NO_COLOR");
    env.remove("ANSI_COLORS_DISABLED");
    env.insert("TERM".to_string(), "xterm-256color".to_string());
    env.insert("COLORTERM".to_string(), "truecolor".to_string());
    env.insert("CLICOLOR".to_string(), "1".to_string());
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_color_suppressors_and_forces_truecolor() {
        let mut base = HashMap::new();
        base.insert("NO_COLOR".to_string(), "1".to_string());
        base.insert("ANSI_COLORS_DISABLED".to_string(), "1".to_string());
        base.insert("PATH".to_string(), "/usr/bin".to_string());

        let out = normalize_pty_env(base);

        assert!(!out.contains_key("NO_COLOR"));
        assert!(!out.contains_key("ANSI_COLORS_DISABLED"));
        assert_eq!(out.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert_eq!(out.get("COLORTERM").map(String::as_str), Some("truecolor"));
        assert_eq!(out.get("CLICOLOR").map(String::as_str), Some("1"));
        assert_eq!(out.get("PATH").map(String::as_str), Some("/usr/bin"));
    }
}
