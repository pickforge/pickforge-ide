//! Probe-only auth-presence detection for the Codex and claude CLIs. Never
//! reads credential files, keychain entries, tokens, or cookies; the only
//! signal is each CLI's own status command, and this module's job is to
//! collapse that command's (potentially account-identifying) output down to
//! a tri-state signal *before* it can leave the process boundary. Callers
//! must never forward the raw stdout/stderr these commands produce anywhere
//! past this module — only [`AuthPresenceProbe`] should cross IPC.

use serde::Serialize;

/// Whether the CLI's own status command reports a signed-in session. Absence
/// of a clear signal is `Unknown`, never `NotAuthenticated` — a probe that
/// can't tell must say so rather than guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthPresenceState {
    Authenticated,
    NotAuthenticated,
    Unknown,
}

/// Non-secret reason `state` is `Unknown`. Derived only from the probe's
/// control flow (was the binary found, did it run, did it time out, did its
/// output match a recognized shape) — never from command output content, so
/// it can never carry an account identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthPresenceUnknownReason {
    NotInstalled,
    CommandFailed,
    Timeout,
    UnrecognizedOutput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPresenceProbe {
    pub state: AuthPresenceState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<AuthPresenceUnknownReason>,
}

impl AuthPresenceProbe {
    pub fn authenticated() -> Self {
        Self {
            state: AuthPresenceState::Authenticated,
            unknown_reason: None,
        }
    }

    pub fn not_authenticated() -> Self {
        Self {
            state: AuthPresenceState::NotAuthenticated,
            unknown_reason: None,
        }
    }

    pub fn unknown(reason: AuthPresenceUnknownReason) -> Self {
        Self {
            state: AuthPresenceState::Unknown,
            unknown_reason: Some(reason),
        }
    }
}

/// Determine auth-presence from `codex login status`'s exit code and output
/// (verified on a real install: exit 0 + `Logged in using ChatGPT` when
/// signed in; exit 1 + `Not logged in` when not — codex-cli 0.144.6). Checks
/// both streams for the logged-out phrase since Codex's exact stream choice
/// isn't a documented contract. Returns `None` — "unrecognized", never a
/// guessed `false` — when neither shape matches, e.g. a future CLI version
/// changes its wording.
pub fn codex_login_status_authenticated(
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> Option<bool> {
    if exit_code == Some(0) && stdout.trim_start().starts_with("Logged in") {
        return Some(true);
    }
    if stdout.contains("Not logged in") || stderr.contains("Not logged in") {
        return Some(false);
    }
    None
}

/// Determine auth-presence from `claude auth status --json`'s stdout. Only
/// the `loggedIn` boolean is ever read out of that JSON — every other field
/// (`email`, `orgId`, `orgName`, `authMethod`, `subscriptionType`, verified
/// present on a real logged-in install) is parsed and immediately discarded,
/// never copied into this function's return value or any log. Per the CLI's
/// own docs, exit status is not a stable signal for this command, so only
/// stdout is inspected.
pub fn claude_auth_status_authenticated(stdout: &str) -> Option<bool> {
    let value: serde_json::Value = serde_json::from_str(stdout).ok()?;
    value.get("loggedIn")?.as_bool()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_recognizes_a_logged_in_session() {
        assert_eq!(
            codex_login_status_authenticated(Some(0), "Logged in using ChatGPT\n", ""),
            Some(true),
        );
        assert_eq!(
            codex_login_status_authenticated(Some(0), "Logged in using an API key\n", ""),
            Some(true),
        );
    }

    #[test]
    fn codex_recognizes_a_logged_out_session_on_either_stream() {
        assert_eq!(
            codex_login_status_authenticated(Some(1), "Not logged in\n", ""),
            Some(false),
        );
        assert_eq!(
            codex_login_status_authenticated(Some(1), "", "Not logged in\n"),
            Some(false),
        );
    }

    #[test]
    fn codex_requires_a_zero_exit_to_trust_the_logged_in_phrase() {
        // A non-zero exit paired with output that merely starts with "Logged
        // in" (e.g. truncated/garbled stderr bleed) must not be trusted as
        // authenticated.
        assert_eq!(
            codex_login_status_authenticated(Some(1), "Logged in using ChatGPT\n", ""),
            None,
        );
    }

    #[test]
    fn codex_reports_unrecognized_for_unexpected_output() {
        assert_eq!(codex_login_status_authenticated(Some(1), "", ""), None);
        assert_eq!(
            codex_login_status_authenticated(Some(127), "command not found\n", ""),
            None,
        );
    }

    #[test]
    fn claude_reads_only_the_logged_in_boolean() {
        assert_eq!(
            claude_auth_status_authenticated(
                r#"{"loggedIn":true,"authMethod":"claude.ai","email":"user@example.com"}"#
            ),
            Some(true),
        );
        assert_eq!(
            claude_auth_status_authenticated(r#"{"loggedIn":false}"#),
            Some(false),
        );
    }

    #[test]
    fn claude_reports_unrecognized_for_malformed_or_shapeless_output() {
        assert_eq!(claude_auth_status_authenticated("{ not json"), None);
        assert_eq!(claude_auth_status_authenticated(""), None);
        assert_eq!(claude_auth_status_authenticated(r#"{"other":1}"#), None);
        assert_eq!(
            claude_auth_status_authenticated(r#"{"loggedIn":"true"}"#),
            None,
        );
    }
}
