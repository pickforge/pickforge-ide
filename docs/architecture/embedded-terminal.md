# Embedded terminal architecture

PickForge is shell-first. Each terminal pane is an xterm.js view connected to a
Rust pseudo-terminal through Tauri IPC; agents are commands typed into the
user's shell, not a separate terminal runtime.

The current path is:

```text
src/components/Terminal.tsx
        │  src/lib/pty.ts
        ▼
src-tauri/src/pty_commands.rs
        ▼
crates/pickforge-core/src/pty/
        └─ portable-pty → local shell or authorized SSH PTY
```

The migration-era design and implementation documents under
`docs/superpowers/` are retained as historical rationale. This page is the
current implementation map.

## Pane and chat ownership

`src/components/TerminalHost.tsx` owns one chat's binary split tree, pane focus,
pane lifetime, and primary-pane promotion. Stable leaf objects keep existing
terminal panes mounted while splits move or resize.

Feature callers do not receive raw terminal handles. They express intent through
`src/stores/terminalHosts.ts`:

- `launchAgentInPrimary` uses the recoverable primary and attributes the agent
  pane once.
- `runInSplit` opens a non-agent command in a fresh split.
- `launchAgentInSplit` opens an attributed one-off agent pane, with an explicit
  local pin for capture files that exist only on this machine.
- `openFileInChat` owns split placement, local/remote path mapping, editor
  command selection, and system-opener fallback.

`src/lib/chatTerminalLifecycle.ts` coordinates the callbacks around a mounted
chat: fresh attach versus reattach ordering, activity/attention, title and agent
pane ownership, primary promotion, and deletion cleanup. Workbench only obtains
a stable binding and disposes it on deletion; it does not reconstruct this
choreography.

## Lifecycle of a chat terminal

```text
chat row loaded from SQLite
          │
          ▼
first activation in src/screens/workbench/Workbench.tsx
          │  ensure local MCP endpoint when eligible
          ▼
TerminalHost mounted and retained while the chat exists
          │
          ├─ primary: attach-or-create local recovery session
          ├─ splits: raw shell PTYs
          └─ remote Project: authorized raw SSH PTYs
          │
          ▼
chat deletion: kill mounted panes, destroy recovery session,
               dispose lifecycle state, delete chat metadata
```

Visited terminal hosts stay mounted but hidden across chat and Project switches,
so switching views does not kill a running shell. The primary pane may use a
local detachable backend:

- `dtach` is the default on supported systems.
- `tmux` uses a PickForge-instance-private server.
- If the selected backend is unavailable, the chat degrades to a raw shell.
- Remote chats use raw SSH PTYs; local recovery wrappers are never applied to a
  remote shell.

Backend selection, private session naming, attach-or-create invocation, and
owned cleanup live in `crates/pickforge-core/src/pty/sessions.rs`.
`src-tauri/src/pty_commands.rs` adapts them to `pty_spawn_chat`, persists no UI
state itself, and ensures delete/exit cleanup targets only PickForge-owned
sessions.

## PTY and routing policy

`crates/pickforge-core/src/pty/session.rs` owns the live `PtyManager` registry and
uses `portable-pty` for spawn, output, input, resize, detach, and kill.
`src-tauri/src/pty_commands.rs` streams output and exit events over Tauri
channels; `src/lib/pty.ts` is the typed frontend client.

Local spawn cwd values must canonicalize under an approved root. That authority
is reconciled from active local Projects by `src-tauri/src/project_roots.rs`.
Remote PTYs skip the local cwd gate only after the Tauri adapter verifies that
the requested host/root is within the Project's persisted remote binding and the
host passes tailnet authorization.

`src/lib/remoteContext.ts` captures pane routing before asynchronous font loading
or spawn work. A captured `null` remains local, a captured remote binding remains
remote, and a nested run cwd stays on the same remote host. There is no silent
local fallback for a remote Project unless a caller explicitly opts into the
separate local-fallback behavior for a non-Project terminal.

See `docs/architecture/remote-host-mode.md` for the remote transport and
credential policy.

## Local MCP discovery

For a local chat, Workbench starts or reuses the in-app endpoint through
`src/stores/mcp.ts` before mounting the first shell that needs it. The store
injects the resolved `PICKFORGE_PROJECT_ROOT`, `PICKFORGE_CONTEXT_DIR`, MCP
adapter command/config, and Unix-socket endpoint through the generic PTY `env`
map. Remote panes never receive local MCP paths.

The endpoint remains local-only:

```text
agent stdio → crates/pickforge-mcp → local Unix socket
                                → src-tauri/src/mcp_commands.rs
                                → crates/pickforge-core/src/mcp/
```

One socket is reused, while state publication is keyed by Project generation and
publication revision and run logs are keyed by Project generation and run epoch.
Stale bind, publish, clear, or append completions cannot replace newer Project or
run state. See `docs/architecture/pickforge-mcp.md`.

## Storage and terminal history

`crates/pickforge-core/src/storage/` defines the resolved context-directory
contract and `crates/pickforge-core/src/transcript/` contains bounded transcript
record/replay primitives. Those transcript primitives are not currently wired
into `src/components/Terminal.tsx`; current terminal continuity comes from
mounted xterm state and the local detachable backend, not from a durable replay
pipeline. Do not treat the presence of `TranscriptRecorder` or
`TranscriptReplayer` as proof that chat output is currently persisted.

Chat metadata, including the recoverable session id, is stored by
`crates/pickforge-core/src/db/` through `src-tauri/src/db_commands.rs`. Storage
locations, retention boundaries, and migration policy are documented in
`docs/architecture/storage.md`.

## Where to read code

| Concern | Current path |
| --- | --- |
| xterm pane and PTY binding | `src/components/Terminal.tsx` |
| Split tree, focus, pane lifetime, primary promotion | `src/components/TerminalHost.tsx` |
| Chat command intent API | `src/stores/terminalHosts.ts` |
| Chat terminal callback coordination | `src/lib/chatTerminalLifecycle.ts` |
| Local/remote routing authority | `src/lib/remoteContext.ts` |
| Typed PTY IPC client | `src/lib/pty.ts` |
| Tauri PTY/security adapter | `src-tauri/src/pty_commands.rs` |
| Core PTY registry and process lifetime | `crates/pickforge-core/src/pty/session.rs` |
| Recoverable chat sessions | `crates/pickforge-core/src/pty/sessions.rs` |
| Context-directory resolution | `crates/pickforge-core/src/storage/` |
| Transcript primitives (not currently integrated) | `crates/pickforge-core/src/transcript/` |
| SQLite metadata store | `crates/pickforge-core/src/db/` |
| Workbench mount/disposal wiring | `src/screens/workbench/Workbench.tsx` |
