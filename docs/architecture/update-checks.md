# Update Checks

Pickforge update checks are build-time configured. Release builds can pass:

```bash
--dart-define=PICKFORGE_UPDATE_METADATA_URL=https://example.test/pickforge/latest.json
```

The default value is empty, so local and development builds do not contact a
network endpoint.

## Metadata

The endpoint must return a JSON object:

```json
{
  "version": "0.2.0+1",
  "downloadUrl": "https://example.test/download",
  "releaseNotesUrl": "https://example.test/releases/0.2.0"
}
```

`version` is required. `downloadUrl` and `releaseNotesUrl` are optional.

## Behavior

- Users can opt out from Settings.
- The check starts after `runApp`, so it does not block first paint.
- The HTTP client uses short connect and receive timeouts.
- Failures are local and non-fatal.
- Requests do not include source code, prompts, screenshots, project paths, or
  user identifiers.
