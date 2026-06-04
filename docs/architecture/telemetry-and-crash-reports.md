# Telemetry and Crash Reports

Telemetry and crash reporting are default-off. Pickforge stores only the local
opt-in preference until a provider is selected after privacy review.

## Opt-In

- The Settings privacy toggle controls `telemetry.enabled`.
- The default value is `false`.
- No provider SDK is initialized while the setting is absent or disabled.
- Enabling the setting only records consent until a reviewed provider
  integration exists.

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

## Provider Gate

Sentry or an equivalent provider can only be integrated after a privacy review
chooses the endpoint, retention policy, redaction behavior, and user-facing
disclosure text.
