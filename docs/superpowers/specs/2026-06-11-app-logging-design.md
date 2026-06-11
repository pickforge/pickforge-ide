# PickForge app logging — design

Date: 2026-06-11. Status: approved (brainstormed with Elberte).

## Problem

PickForge has no persistent log. `DiagnosticsService` keeps a 100-entry
in-memory ring buffer that dies with the process; uncaught errors go to a
console nobody sees in release builds. When the app misbehaves on a user's
machine there is no forensic trail to attach to a bug report.

## Decisions

- **One log file per app run** in the app-support directory
  (`<appSupport>/logs/pickforge_<timestamp>.log`), plus `latest.log`
  pointing at the current run. No separate ever-growing "macro" file:
  history across runs = retained per-run files.
- **Retention:** on startup prune to the newest 10 run files / 20 MB total.
  A single run's file is capped at 5 MB (writer stops appending past the
  cap and records one final "log truncated" line).
- **Format:** plain text, one line per record:
  `2026-06-11T11:20:33.412Z [info] [pty.session] message`. JSONL deferred.
- **API:** `package:logging` (Dart team). Subsystems use hierarchical
  loggers (`Logger('pty.session')`, `Logger('chats')`). One subscription
  on `Logger.root` fans out to sinks.
- **Sinks:** (1) `LogFileWriter` — buffered file writes, flush every 2 s,
  immediately on `WARNING`+, and on app exit; (2) `DiagnosticsService` —
  ingests records into its existing ring buffer so the support bundle and
  Settings UI keep working.
- **Redaction:** every line passes the existing `ContextRedactor` before
  it is buffered. Terminal output is never logged (transcripts already
  cover it per chat); app events reference chat/pane ids only.
- **Uncaught errors:** `FlutterError.onError` and
  `PlatformDispatcher.onError` log SEVERE with stack traces, chained with
  the existing keyboard-assertion guard in `main.dart`.
- **Verbosity:** Settings → Diagnostics gains a Normal/Verbose toggle
  (persisted in SharedPreferences; Verbose = `Level.FINE`, Normal =
  `Level.INFO`) and an "Open logs folder" button. The support bundle
  appends the tail (~200 lines) of the current run log.

## Components

| Unit | Responsibility |
| --- | --- |
| `lib/core/logging/log_file_writer.dart` | Run-file naming, `latest.log`, buffered writes, flush policy, size cap, prune-on-start. No knowledge of `package:logging`. |
| `lib/core/logging/app_logging.dart` | Owns setup: root level, redaction, record formatting, fan-out to writer + diagnostics, error-hook chaining, dispose/flush. |
| `lib/core/logging/log_settings.dart` | Persisted verbosity (SharedPreferences repo, same pattern as `EmbeddedTerminalSettings`). |
| Call sites | PTY session lifecycle, session pool, projects/chats cubits, DB migrations, app start/stop. Existing `diagnostics.recordLog` call sites migrate to loggers. |

`DiagnosticsService` stays the single record hub (implementation detail,
chosen over re-routing its internals): `recordLog` keeps feeding the ring
buffer and forwards every redacted line through a new `onRecord` hook that
`AppLogging` points at the file writer. Logger records flow
Logger → `AppLogging` → `recordLog` → ring buffer + file; legacy
`recordLog`/`recordFailure` call sites take the same path. One redaction
pass, no feedback loop, zero behavior change for existing diagnostics
consumers and tests.

## Out of scope

- Logging terminal/PTY output content.
- In-app log viewer UI.
- Structured JSONL output.
- Remote upload (Sentry remains the separate, opt-in crash channel).

## Testing

- `LogFileWriter`: write/flush, cap, prune ordering, latest.log.
- `app_logging`: records reach writer + diagnostics redacted; level honors
  the setting; uncaught-error hook writes SEVERE.
- Settings repo round-trip; Settings UI smoke (dropdown + button render).
