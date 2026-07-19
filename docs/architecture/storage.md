# PickForge storage and retention

PickForge is local-first. Project metadata, runtime context, screenshots,
settings, and diagnostics stay on the user's machine unless the user explicitly
exports or copies them.

The current storage path follows the same Rust core → Tauri adapter → SolidJS
client architecture as the rest of the app:

```text
crates/pickforge-core/src/storage/   context path policy
crates/pickforge-core/src/db/        SQLite schema, migrations, queries
                 │
                 ▼
src-tauri/src/db_commands.rs         typed metadata IPC
src-tauri/src/fs_commands.rs         approved-root file/read/open IPC
src-tauri/src/project_roots.rs       canonical local path authority
                 │
                 ▼
src/lib/db.ts + frontend stores
```

## Storage boundaries

PickForge writes durable data into distinct owned areas:

1. **App metadata database** — `<PickForgeHome>/pickforge.db`, opened by
   `src-tauri/src/lib.rs` and implemented with `rusqlite` in
   `crates/pickforge-core/src/db/`.
2. **Resolved Project context** — paths computed by
   `crates/pickforge-core/src/storage/` for generated context, runs, chats,
   pastes, skills, prompt templates, and the local MCP discovery file.
3. **Inspector captures** — `<PickForgeHome>/inspect` by default, or the explicit
   per-Project opt-in `<projectRoot>/.pickforge/inspect`, owned by
   `src/stores/inspectStorage.ts` and the save/read commands in `src-tauri/src/`.
4. **Runtime-only sockets and recovery state** — private runtime directories,
   not source repositories. PTY recovery ownership is in
   `crates/pickforge-core/src/pty/sessions.rs`; the MCP socket lifecycle is in
   `src-tauri/src/mcp_commands.rs`.

`PickForgeHome` is `$PICKFORGE_HOME` when set, otherwise the platform home plus
`.pickforge`, as resolved by `crates/pickforge-core/src/storage/home.rs`. The
process launch directory is not the storage default.

## Resolved Project context

`ContextStorageService` in `crates/pickforge-core/src/storage/service.rs`
supports three location contracts:

1. **Home (default)** — `<PickForgeHome>/projects/<projectId>/`; generated root
   context is under `context/`, while `runs/`, `chats/`, `pastes/`, `skills/`,
   and `prompt-templates/` are siblings.
2. **Project-local** — `<projectRoot>/.pickforge/`; explicit opt-in or automatic
   only when the exact PickForge marker already exists.
3. **Custom** — `<customPath>/projects/<projectId>/`, with the same shape as Home.

`crates/pickforge-core/src/storage/project_id.rs` derives the stable Project id
from the normalized Project path. An explicit location wins over automatic
detection. Without one, the exact project-local marker (`.pickforge/.gitignore`
containing `*` plus a newline) selects project-local mode; otherwise Home wins.

The core resolver supports all three contracts. Current MCP startup in
`src-tauri/src/mcp_commands.rs` calls it without an explicit override, so that
integration uses marker-based automatic detection rather than reading the
persisted storage fields itself.

PickForge must not overwrite a user-owned `.pickforge/` directory. In
project-local mode, `ContextStorageService::ensure` refuses an existing directory
without the exact ownership marker. Home and custom paths are outside the repo
and do not use that marker.

## Current generated layout

The resolved structure is:

```text
# Project-local mode
<projectRoot>/.pickforge/
  .gitignore
  <generated context files>
  ipc.sock-path
  chats/
  runs/
  pastes/
  skills/
  prompt-templates/

# Home/custom mode
<base>/projects/<projectId>/
  context/
    <generated context files>
    ipc.sock-path
  chats/
  runs/
  pastes/
  skills/
  prompt-templates/
```

The local MCP endpoint resolves and creates `context/`, `runs/`, and `chats/`
and writes discovery under the context directory. The endpoint itself is a
private Unix socket under the runtime directory, not inside the Project and
never a network listener. `src/stores/mcp.ts` keys Project publication by
binding generation/revision and run logs by generation/run epoch so stale async
work cannot publish into a newer Project or run.

Generated root context files may be replaced by newer captures. Project-local
skills and prompt templates are user-editable overrides and must not be included
in support bundles by default.

## Metadata database

`crates/pickforge-core/src/db/mod.rs` owns one SQLite connection behind a mutex,
enables WAL and foreign keys, and stores:

- Projects and per-Project settings, including remote bindings.
- Chat metadata and recoverable session ids.
- Pick and run-session history.
- Structured agent sessions, messages, and timeline items.
- Orchestra state and Operator audit records.

Full terminal transcript text and screenshots are not database rows. The Rust
store accepts legacy schema versions 1–10, reconciles them additively, then uses
numbered Rust migrations beginning at version 11. New schema changes must bump
the current version and add focused migration coverage.

Run-session queries are caller-limited, but the current database implementation
does not automatically prune old rows. Support bundles must continue to exclude
source files, prompts, screenshots, terminal output, and secrets by default.

## Approved-root security boundary

Persisted Project membership and local filesystem authority are related but not
the same thing. `src-tauri/src/project_roots.rs` is the single owner of the
projection from active database rows to canonical approved roots:

- startup, Project list refresh, and every Project mutation reconcile the full
  active set;
- archive/delete and cross-process removal revoke local authority on the next
  reconciliation;
- a native directory pick is tracked separately until its Project row is
  persisted;
- canonicalization blocks traversal and symlink escape;
- filesystem roots and the user's whole home directory are too broad to approve;
- a remote-bound Project's local mirror is excluded because the remote host/root
  is authoritative.

`src-tauri/src/fs_commands.rs` and `src-tauri/src/pty_commands.rs` consume this
authority for local file access and PTY cwd validation. Remote PTYs instead
validate the stored Project/host/root binding and tailnet host authorization.
See `docs/architecture/remote-host-mode.md`.

## Inspector capture policy

Inspector capture location is separate from the general context resolver.
`src/stores/inspectStorage.ts` defaults to `<PickForgeHome>/inspect` and stores a
per-Project opt-in for `<projectRoot>/.pickforge/inspect`.

The Tauri save/read boundary only accepts these owned shapes. Reads canonicalize
the file, require containment under an approved root, cap image reads at 16 MiB,
and verify the PNG signature before returning a data URL. A Project-local
capture opt-in does not broaden authority beyond that active Project root.

## Transcript primitives and retention

`crates/pickforge-core/src/transcript/` contains a bounded recorder/replayer
format:

```text
chats/<chatId>/
  transcript.log
  transcript.spans.bin
  meta.json
```

The recorder keeps at most 5 MiB after the log crosses a 6 MiB truncation
threshold. These primitives are currently not connected to
`src/components/Terminal.tsx`, so the format and limits are implemented core
policy, not evidence that current chats persist terminal output. Until that
integration exists, terminal continuity is provided by mounted xterm state and
local detachable PTY sessions. Documentation and support tooling must not claim
or collect durable transcript files unconditionally.

## Migration, backup, and cleanup policy

For every user-facing schema change:

- add a migration test from the previous released schema;
- prove supported older schemas still open on the latest schema;
- record the backup decision in the PR or release notes;
- never delete the original database or a Project context directory after a
  failed migration.

Once a release requires pre-open database backup, backup failure must block the
migration unless the user explicitly chooses to continue.

Automated cleanup must never remove an entire resolved Project context directory
or an unknown `.pickforge/` directory. It may remove only artifacts it owns and
can identify by path, schema, and lifecycle. Switching locations, when exposed
by a caller, must remain additive and non-destructive: do not clobber destination
files or silently delete the source.
