# Telemetry and Crash Reports

Telemetry and crash reporting are default-off. Pickforge initializes Sentry
only when the local opt-in preference is enabled and a build-time Sentry DSN is
provided.

## Opt-In

- The Settings privacy toggle controls `telemetry.enabled`.
- The default value is `false`.
- No provider SDK is initialized while the setting is absent or disabled.
- Enabling the setting still does nothing unless `PICKFORGE_SENTRY_DSN` is set
  at build time.

## Crash Provider

Sentry is the reviewed crash provider for the first provider integration.

Build-time configuration:

- `PICKFORGE_SENTRY_DSN`: required to initialize Sentry.
- `PICKFORGE_SENTRY_ENVIRONMENT`: optional, defaults to `local`.
- `PICKFORGE_RELEASE`: optional release identifier.

Runtime behavior:

- Sentry is not initialized when telemetry is disabled.
- Sentry is not initialized when the DSN is empty.
- If Sentry initialization fails before app startup, Pickforge still starts
  without crash reporting.
- Native crash handling, sessions, performance tracing, user interaction
  breadcrumbs, screenshots, view hierarchy capture, package reporting, and
  default PII are disabled.
- Breadcrumbs are dropped before collection.
- Feedback and transactions are dropped before send.
- Crash events are rebuilt in `beforeSend` with only a generic message,
  sanitized exception type, redacted exception value, basename-only stack frame
  filename, function name, line/column, release/environment, and a privacy tag.
- Attachments, screenshots, and view hierarchy data are cleared in `beforeSend`.

## Event Schema

Future events must use this envelope:

```json
{
  "event": "app.start",
  "version": 1,
  "occurredAt": "2026-06-04T12:00:00Z",
  "appVersion": "0.1.0+1",
  "os": "linux",
  "properties": {
    "route": "demo",
    "agentProfile": "codex"
  }
}
```

`event`, `version`, `occurredAt`, `appVersion`, and `os` are required.
`properties` is optional and must contain only bounded primitive values.

## Allowed Properties

- App route or feature area.
- Agent profile id, not model prompt or transcript.
- Tool availability booleans.
- Non-identifying error category.
- Duration/count metrics.
- Build metadata already exposed in diagnostics.

## Forbidden Data

- Source code, file contents, prompts, transcripts, screenshots, or context
  previews.
- Project paths, usernames, hostnames, device serials, auth tokens, API keys, or
  private repository URLs.
- Raw exception messages before redaction.
- Stable user identifiers unless a future account system has separate consent.

## Privacy Review Outcome

The first provider review selected Sentry with strict local gating and
redaction:

- Endpoint: the build-time `PICKFORGE_SENTRY_DSN`.
- Retention: controlled in the configured Sentry project.
- Redaction: implemented by `CrashReportService` before any event is sent.
- Disclosure: the existing Settings privacy toggle remains the user-facing
  control; wording should be expanded before enabling a production DSN.
