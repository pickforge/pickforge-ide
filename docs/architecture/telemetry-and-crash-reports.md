# Telemetry and Crash Reports

PickForge only ships crash/error reporting today. Release builds initialize
Sentry by default unless the local preference disables it. Debug builds keep
Sentry disabled unless `PICKFORGE_SENTRY_DEBUG=1` is set for local verification.

## User Control

- Settings → Crash reports writes `~/.pickforge/telemetry.json`.
- Missing config defaults to `{"crash_reports": true}`.
- Malformed JSON defaults to `{"crash_reports": true}`.
- Other read failures disable crash reports for that run.
- Turning the setting off applies after restart.

## Crash Provider

Sentry is the crash provider.

Runtime behavior:

- The public Sentry DSN is compiled into the Tauri shell.
- Events use release `pickforge@<tauri.conf.json version>`.
- When disabled, the Rust SDK is initialized with an empty DSN and the Tauri
  plugin is installed without browser SDK injection.
- Native minidumps are enabled only when crash reports are enabled. If minidump
  init fails, PickForge logs the error to stderr and continues.
- `send_default_pii` is not enabled.
- `before_send` clears `server_name` and all breadcrumbs before events leave the
  process.
- PickForge does not add file contents, terminal transcripts, prompts,
  screenshots, forged context, project paths, user ids, or stable identifiers to
  Sentry events.
- Events may include SDK-default crash stack traces, error messages, OS/runtime
  metadata, app version, release, loaded system library/debug image data, and
  native minidump data.
- Native crash dumps include a snapshot of process memory at crash time. That
  can contain fragments of data in memory, including terminal output or prompt
  text. Error messages can occasionally reference file paths.

Release CI uploads native debug files and frontend sourcemaps to Sentry when
`SENTRY_AUTH_TOKEN` is configured. Without that secret, the upload step skips.

## Forbidden Data

- Source code, file contents, prompts, transcripts, screenshots, or context
  previews intentionally added by PickForge code.
- Project paths, usernames, hostnames, device serials, auth tokens, API keys, or
  private repository URLs added by PickForge code.
- Stable user identifiers unless a future account system has separate consent.
