# Pickforge Storage and Retention

Pickforge is local-first. Runtime context, transcripts, screenshots, settings,
and diagnostics stay on the user's machine unless the user deliberately copies
or exports them.

## Storage Boundaries

Pickforge writes to two places:

- The app database managed by Drift, named `pickforge`.
- The active project's **resolved context directory**.

Where the context directory lives is a per-project choice (Settings → Context
storage), resolved by `ContextStorageService.resolve`:

1. **Home** (default) — `<PickforgeHome>/projects/<projectId>/` where
   `PickforgeHome` is `$PICKFORGE_HOME` or `~/.pickforge`. The context dir is
   `<base>/context`, with `runs/`, `chats/`, `pastes/`, `skills/`, and
   `prompt-templates/` as siblings. Nothing is written into the repo.
2. **Project-local** — `<projectRoot>/.pickforge/`. Opt-in per project.
3. **Custom** — `<customPath>/projects/<projectId>/`, same layout as Home.

Resolution precedence is: an explicit `location:` argument, then the persisted
per-project override, then auto-detect (an existing project-local `.pickforge/`
marker → project-local, otherwise Home).

Pickforge must not modify project source files, `CLAUDE.md`, `AGENTS.md`, or
other user-owned context files. The `.gitignore` marker rule applies to
**project-local mode only**: if `<projectRoot>/.pickforge/` already exists
without Pickforge's exact marker (`*` plus newline), Pickforge refuses to use it
instead of overwriting unknown data. Home and custom directories live outside
the repo and carry no marker.

Switching a project's storage mode offers to copy existing chats, runs, and
context files from the old resolved location to the new one. The copy is
best-effort and additive: originals are never deleted and existing destination
files are never clobbered, so switching back still shows the old data. Active
terminals and runs keep their inherited paths until respawned — there is no live
migration of running sessions.

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

## Context directory layout

In **project-local** mode the directory is `<projectRoot>/.pickforge/`, private
runtime state ignored by Git by default:

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

In **home** and **custom** modes the same content lives under
`<base>/projects/<projectId>/`, with the root context files in `<base>/context/`
and `chats/`, `runs/`, `pastes/`, `skills/`, and `prompt-templates/` as siblings
of `context/`. There is no `.gitignore` marker because the directory is outside
the repo.

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

No automated cleanup may remove the resolved context directory as a whole — not
the project-local `.pickforge/`, nor a home/custom `projects/<projectId>/`
directory. Cleanup code may only delete files that it owns and can identify by
path and schema.
