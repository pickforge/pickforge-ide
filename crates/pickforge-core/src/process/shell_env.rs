//! Resolve the user's real interactive shell environment (PATH and friends).
//!
//! GUI apps launched outside a terminal inherit a minimal desktop-session
//! environment that omits paths added by `~/.bashrc` / `~/.zshrc` / `~/.profile`
//! (bun, npm-global, cargo, pipx, volta, asdf, mise, …). We spawn the login
//! shell, read its `env`, and merge it over the inherited environment. The
//! result is cached once resolution succeeds; a transient miss (e.g. a
//! launch-time timeout) is not cached, so the next call retries rather than
//! stranding the app on the minimal PATH.
//!
//! Ported from `user_shell_environment.dart`.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();
/// Serializes login-shell resolution and carries the running attempt count, so
/// only one shell spawns at a time and a failed attempt can never cache the
/// fallback while another thread is still capturing an authoritative env.
static RESOLVE_LOCK: Mutex<u32> = Mutex::new(0);
/// Set when PickForge itself injects `WEBKIT_DISABLE_DMABUF_RENDERER` into
/// the process environment for the persisted Linux Compatibility graphics
/// mode (#238). WebKitGTK needs that as a real process env var before it
/// initializes, but PickForge must not forward a mode-synthesized value to
/// shells/agents it spawns — only to explicit values the user already set
/// before launching PickForge. Must be called (if at all) before the first
/// `user_shell_environment()` call.
static DMABUF_ENV_SYNTHESIZED: AtomicBool = AtomicBool::new(false);

/// Marks that `WEBKIT_DISABLE_DMABUF_RENDERER` in the current process
/// environment was set by PickForge's Linux graphics mode, not the user, so
/// [`user_shell_environment`] strips it before handing an environment to
/// spawned shells or agents.
pub fn mark_linux_dmabuf_env_synthesized() {
    DMABUF_ENV_SYNTHESIZED.store(true, Ordering::SeqCst);
}

/// How many times we re-spawn the login shell before giving up and caching the
/// un-enriched inherited environment. A packaged GUI app's first resolution can
/// land during launch-time contention (Gatekeeper scanning a freshly downloaded
/// bundle, a shell rc doing its periodic update `git fetch`) and overrun the
/// budget. Caching that miss permanently would pin PATH to the minimal desktop
/// set — leaving every `claude` / `codex` spawn broken — for the whole session;
/// retrying on the next call lets a transient miss self-heal.
const MAX_RESOLVE_ATTEMPTS: u32 = 5;

/// The resolved, enriched login-shell environment (PATH and friends). Cached for
/// the process lifetime once resolution succeeds; a failed attempt is *not*
/// cached, so a later call re-attempts instead of inheriting a broken PATH.
pub fn user_shell_environment() -> &'static HashMap<String, String> {
    if let Some(env) = CACHE.get() {
        return env;
    }
    // Serialize resolution: one shell spawn at a time, and no failed attempt can
    // cache the fallback while another thread is mid-capture of a good env.
    let mut attempts = RESOLVE_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    // Another thread may have resolved while we waited for the lock.
    if let Some(env) = CACHE.get() {
        return env;
    }
    let (env, resolved) = resolve(std::env::vars().collect());
    *attempts += 1;
    if resolved || *attempts >= MAX_RESOLVE_ATTEMPTS {
        // Commit permanently. If another thread won the race, keep its value.
        let _ = CACHE.set(env);
        return CACHE.get().expect("cache populated above");
    }
    // Transient miss with retries left: hand this caller the inherited env
    // without poisoning the cache so the next call re-attempts resolution.
    // Bounded by MAX_RESOLVE_ATTEMPTS, so this leaks at most a few small maps.
    Box::leak(Box::new(env))
}

/// Resolve the environment and report whether the result is *authoritative*.
/// `false` means the login-shell capture was skipped or failed (no `SHELL`, or a
/// spawn/timeout miss) and the caller should retry — not that enrichment is
/// impossible. Windows and the explicit inherited-only flag are authoritative.
fn resolve(base: HashMap<String, String>) -> (HashMap<String, String>, bool) {
    let (mut env, authoritative) = resolve_inner(base);
    // Strip last, after any login-shell merge: the spawned login shell also
    // inherits the ambient process env, so a mode-synthesized
    // WEBKIT_DISABLE_DMABUF_RENDERER would otherwise round-trip right back in
    // via its own `env` output (#238).
    if DMABUF_ENV_SYNTHESIZED.load(Ordering::SeqCst) {
        env.remove("WEBKIT_DISABLE_DMABUF_RENDERER");
    }
    (env, authoritative)
}

fn resolve_inner(base: HashMap<String, String>) -> (HashMap<String, String>, bool) {
    if cfg!(windows) || base.get("PICKFORGE_INHERITED_ENV_ONLY").map(String::as_str) == Some("1") {
        return (base, true);
    }

    let shell = match base.get("SHELL") {
        Some(s) if !s.is_empty() && Path::new(s).exists() => s.clone(),
        _ => return (base, false),
    };

    match run_shell_env(&shell, Duration::from_secs(6)) {
        Some(output) => {
            let parsed = parse_env(&output);
            if parsed.is_empty() {
                // Captured stdout carried no assignments (the shell exited before
                // it ran `env`, or emitted only noise): not authoritative — the
                // caller should retry rather than pin the inherited PATH.
                return (base, false);
            }
            let mut merged = base;
            for (key, value) in parsed {
                merged.insert(key, value);
            }
            (merged, true)
        }
        None => (base, false),
    }
}

/// Run `$SHELL -ilc env` with a hard timeout, draining stdout concurrently so a
/// large environment can't deadlock the pipe. Dependency-free.
fn run_shell_env(shell: &str, timeout: Duration) -> Option<String> {
    let mut child = Command::new(shell)
        .args(["-ilc", "env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    // Bound the stdout read by the budget.
    let output = rx.recv_timeout(timeout).ok();

    // Reap the child so it never orphans. If output arrived (stdout hit EOF, so
    // the shell finished writing) give it a brief grace to exit, then kill;
    // if we timed out waiting for output, kill immediately.
    match &output {
        Some(_) => reap_within(&mut child, Duration::from_millis(500)),
        None => {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // Join the reader only once it has finished (output present). A reader still
    // blocked on a descendant holding stdout open is detached, not joined.
    if output.is_some() {
        let _ = reader.join();
    } else {
        drop(reader);
    }

    // A captured env is authoritative even if the interactive shell exited
    // non-zero (a benign rc hook, a compaudit warning) or reaped slowly under
    // load: we only ever read complete stdout on EOF, and `parse_env` ignores
    // anything that isn't a `KEY=value` line. Gating on exit status is what
    // previously discarded a perfectly good PATH.
    output
}

/// Wait up to `budget` for the child to exit on its own; kill + reap it if it
/// overruns so we never block or orphan. The exit status is irrelevant here —
/// the caller already holds the captured output.
fn reap_within(child: &mut std::process::Child, budget: Duration) {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if start.elapsed() < budget => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
        }
    }
}

fn parse_env(raw: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;

    // `lines()` matches Dart's LineSplitter: splits on \n and \r\n and does not
    // emit a trailing empty element for a final newline.
    for line in raw.lines() {
        if let Some(eq) = line.find('=') {
            if eq > 0 && is_valid_env_name(&line[..eq]) {
                if let Some(pair) = current.take() {
                    out.push(pair);
                }
                current = Some((line[..eq].to_string(), line[eq + 1..].to_string()));
                continue;
            }
        }
        // Continuation line (multi-line exported function bodies, etc.).
        if let Some((_, value)) = current.as_mut() {
            value.push('\n');
            value.push_str(line);
        }
    }
    if let Some(pair) = current {
        out.push(pair);
    }
    out
}

fn is_valid_env_name(s: &str) -> bool {
    let mut chars = s.bytes();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == b'_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_assignments() {
        let env = parse_env("PATH=/usr/bin\nHOME=/home/dev\n");
        assert_eq!(env.len(), 2);
        assert_eq!(env[0], ("PATH".into(), "/usr/bin".into()));
        assert_eq!(env[1], ("HOME".into(), "/home/dev".into()));
    }

    #[test]
    fn folds_continuation_lines_into_the_previous_value() {
        let env = parse_env("FOO=line1\nstill-foo\nBAR=baz");
        assert_eq!(env[0], ("FOO".into(), "line1\nstill-foo".into()));
        assert_eq!(env[1], ("BAR".into(), "baz".into()));
    }

    #[test]
    fn ignores_lines_without_a_valid_name() {
        let env = parse_env("=leading\n123=nope\nGOOD_1=yes");
        // "=leading" and "123=nope" are not valid assignments; with no prior
        // key they are dropped.
        assert_eq!(env, vec![("GOOD_1".into(), "yes".into())]);
    }

    #[test]
    fn validates_env_names() {
        assert!(is_valid_env_name("PATH"));
        assert!(is_valid_env_name("_x9"));
        assert!(!is_valid_env_name(""));
        assert!(!is_valid_env_name("9bad"));
        assert!(!is_valid_env_name("has-dash"));
    }

    #[test]
    fn resolves_a_non_empty_environment_with_path() {
        // On a real machine the merged env always carries PATH.
        let env = user_shell_environment();
        assert!(env.contains_key("PATH") || env.contains_key("Path"));
    }

    #[test]
    fn inherited_only_flag_is_authoritative_and_skips_the_shell() {
        // The explicit opt-out returns the inherited env verbatim and is final,
        // so callers never retry it.
        let mut base = HashMap::new();
        base.insert("PICKFORGE_INHERITED_ENV_ONLY".to_string(), "1".to_string());
        base.insert("PATH".to_string(), "/only/this".to_string());
        let (env, resolved) = resolve(base);
        assert!(resolved);
        assert_eq!(env.get("PATH").map(String::as_str), Some("/only/this"));
    }

    #[cfg(unix)]
    #[test]
    fn missing_shell_is_a_retryable_miss_not_authoritative() {
        // No usable SHELL: resolution can't enrich yet, so it reports the miss
        // as non-authoritative and hands back the inherited env for retry.
        let mut base = HashMap::new();
        base.insert("PATH".to_string(), "/usr/bin".to_string());
        let (env, resolved) = resolve(base);
        assert!(!resolved);
        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin"));
    }

    /// Rust runs tests in parallel threads within one process, and
    /// `DMABUF_ENV_SYNTHESIZED` is process-global, so every test that touches
    /// it must serialize on this lock (mirrors `PICKFORGE_HOME_ENV_LOCK` in
    /// `src-tauri/src/test_support.rs`).
    static DMABUF_FLAG_TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Resets `DMABUF_ENV_SYNTHESIZED` on drop, including on panic, so one
    /// test's mutation of the process-global flag can never leak into
    /// another test running after it under the same lock.
    struct DmabufFlagGuard;
    impl Drop for DmabufFlagGuard {
        fn drop(&mut self) {
            DMABUF_ENV_SYNTHESIZED.store(false, Ordering::SeqCst);
        }
    }

    #[test]
    fn synthesized_dmabuf_flag_strips_it_from_the_inherited_env() {
        let _lock = DMABUF_FLAG_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let _guard = DmabufFlagGuard;
        DMABUF_ENV_SYNTHESIZED.store(true, Ordering::SeqCst);

        let mut base = HashMap::new();
        base.insert("PICKFORGE_INHERITED_ENV_ONLY".to_string(), "1".to_string());
        base.insert(
            "WEBKIT_DISABLE_DMABUF_RENDERER".to_string(),
            "1".to_string(),
        );
        base.insert("PATH".to_string(), "/usr/bin".to_string());

        let (env, resolved) = resolve(base);
        assert!(resolved);
        assert!(!env.contains_key("WEBKIT_DISABLE_DMABUF_RENDERER"));
        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin"));
    }

    #[test]
    fn unset_dmabuf_flag_leaves_an_explicit_value_untouched() {
        // Default (flag never marked): a value the *user* set before launch
        // must survive untouched — only a mode-synthesized value is stripped.
        let _lock = DMABUF_FLAG_TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        debug_assert!(!DMABUF_ENV_SYNTHESIZED.load(Ordering::SeqCst));
        let mut base = HashMap::new();
        base.insert("PICKFORGE_INHERITED_ENV_ONLY".to_string(), "1".to_string());
        base.insert(
            "WEBKIT_DISABLE_DMABUF_RENDERER".to_string(),
            "1".to_string(),
        );

        let (env, resolved) = resolve(base);
        assert!(resolved);
        assert_eq!(
            env.get("WEBKIT_DISABLE_DMABUF_RENDERER").map(String::as_str),
            Some("1")
        );
    }

    #[cfg(unix)]
    #[test]
    fn empty_shell_output_is_a_retryable_miss_not_authoritative() {
        use std::os::unix::fs::PermissionsExt;
        // A shell that exits before emitting any env (here: ignores its args and
        // exits 0) must not be cached as authoritative — otherwise a launch-time
        // glitch would pin the minimal inherited PATH for the whole session.
        let dir = std::env::temp_dir().join(format!(
            "pf-shellenv-empty-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("silent-shell");
        std::fs::write(&fake, b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

        let mut base = HashMap::new();
        base.insert("SHELL".to_string(), fake.to_string_lossy().into_owned());
        base.insert("PATH".to_string(), "/usr/bin".to_string());
        let (env, resolved) = resolve(base);
        assert!(!resolved);
        assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
