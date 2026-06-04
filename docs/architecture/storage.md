# Pickforge Storage and Retention

Pickforge is local-first. Runtime context, transcripts, screenshots, settings,
and diagnostics stay on the user's machine unless the user deliberately copies
or exports them.

## Storage Boundaries

Pickforge writes to two places:

- The app database managed by Drift, named `pickforge`.
- The active project's `<projectRoot>/.pickforge/` directory.

Pickforge must not modify project source files, `CLAUDE.md`, `AGENTS.md`, or
other user-owned context files. If `<projectRoot>/.pickforge/` already exists
without Pickforge's exact `.gitignore` marker (`*` plus newline), Pickforge must
refuse to use it instead of overwriting unknown data.

## Drift Data

The Drift database stores app-level metadata:

- Known projects and active project settings.
- Chat metadata, not full transcript text.
- Pick history and agent run metadata.
- Run-session history for recent app launches.

Run-session history is capped by `RunSessionLogRepository.recordStart` and
`RunSessionLogDao.pruneToCap`; the default cap is the latest 100 sessions per
project. Support bundles must continue to exclude source files, prompts,
screenshots, transcripts, and secrets by default.

## `.pickforge/` Layout

The project-local directory is private runtime state and is ignored by Git by
default:

```text
.pickforge/
  .gitignore
  skill-active.md
  widget-context.md
  initial-prompt.md
  screenshot.png
  device-screen.png
  device-screen-after-hot-reload.png
  ipc.sock-path
  skills/
  prompt-templates/
  chats/
    <chatId>/
      transcript.log
      transcript.spans.bin
      meta.json
  runs/
    <sessionId>/
      log.jsonl
      session.json
```

Root context files such as `skill-active.md`, `widget-context.md`, and
`initial-prompt.md` are overwritten for the latest Forge request. Chat
transcripts are append-only per chat and are bounded by `TranscriptRecorder`:
the default kept transcript text is 5 MiB, with truncation triggered after the
file grows beyond 6 MiB. Run event files are scoped to a single run session.
Recoverable run metadata in `session.json` is removed when the run is no longer
recoverable or after cleanup.

Project-local skills and prompt templates are user-editable overrides under
`.pickforge/skills/` and `.pickforge/prompt-templates/`. They are still private
local files and must not be included in support bundles by default.

## Migration and Backup Policy

Before a user-facing release that changes `PickforgeDatabase.schemaVersion`,
the migration PR must include:

- A migration test from the previous released schema to the new schema.
- Coverage showing older released schemas still open on the latest schema.
- A backup decision recorded in the release notes or PR description.

Once Pickforge has real external users, every schema-version bump must create a
best-effort copy of the existing Drift database before opening it with the new
schema. Backup failures must block migration unless the user explicitly chooses
to continue. A failed migration must never delete the original database or the
project-local `.pickforge/` directory.

No automated cleanup may remove `.pickforge/` as a whole. Cleanup code may only
delete files that it owns and can identify by path and schema.
