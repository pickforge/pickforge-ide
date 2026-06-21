# PickForge MCP endpoint

PickForge exposes a small, **local-only** MCP server so an agent running in the
embedded terminal (Claude / Codex) can re-query live context mid-task. It serves
four capability-gated tools over a Unix socket; the agent reaches it through a
thin stdio adapter that PickForge ships.

## Why this shape (transport decision)

Two parts, splitting protocol from transport:

1. **In-app socket server** (`src-tauri/src/mcp_commands.rs`). The live state the
   tools need — the active target, the device serial, the current inspector
   selection, recent run logs — already lives in the running app. Hosting the
   server *inside* the app means it reads that state directly instead of
   re-deriving it. It binds a Unix domain socket and speaks newline-delimited MCP
   JSON-RPC. No network listener is ever opened.
2. **Stdio adapter** (`crates/pickforge-mcp`). MCP hosts spawn a *stdio* server
   and talk JSON-RPC over its stdin/stdout. `pickforge-mcp` is a dependency-light
   byte-pump: it resolves the live socket from the `PICKFORGE_*` env the embedded
   terminal already carries, connects, and pumps frames in both directions. It
   contains **no** protocol logic, so it can never drift from the server.

The MCP wire format + tool logic live once, in `crates/pickforge-core/src/mcp/`
(hand-rolled JSON-RPC — the surface is `initialize`, `tools/list`, `tools/call`,
too small to justify a framework). The same code backs the in-app server, the
adapter's expectations, and the unit + socket tests.

```
agent (Claude/Codex)  ──stdio JSON-RPC──▶  pickforge-mcp  ──unix socket──▶  PickForge app
                                            (byte pump)                      (core::mcp + live state)
```

## Tools

All four are gated on the **active target's** capabilities (the camelCase
`Capability` set from `targets/adapters.rs`). A gated or empty answer is a
*successful* result with `available: false` and a `reason` — never an error — so
an agent can always read a clear signal.

| Tool | Input | Returns |
| --- | --- | --- |
| `get_current_selection` | — | The live selected UI element for the active target: the Flutter VM-Service widget (`inspectorKind: vmService`) or the UIAutomator `A11yNode` (`uiAutomator`). `{ available, kind, targetId, selection }`, or `{ available:false, reason }`. Gated on `inspectSelection`. |
| `capture_screenshot` | — | `{ available, path }` — an absolute PNG path written under the context dir (live `adb` capture for Android). Gated on `captureScreenshot`. |
| `get_run_logs` | `{ limit?: 1..1000 }` | `{ available, lineCount, lines }` — recent run-console / logcat lines, newest last. Gated on `streamLogs`. |
| `get_project_context` | — | `{ projectRoot, activeTargetId, activeTargetLabel, supportTier, capabilities, storage:{contextDir,runsDir,chatsDir} }`. Always available. |

`get_current_selection` routes to the adapter the active target drives, so the
caller never special-cases a framework — Flutter returns a `WidgetNode`, Android
an `A11yNode`, both under the same envelope.

## Live state

The frontend is the source of truth for what is *active*. It publishes a snapshot
(`mcp_publish_state`) whenever the active target, device, project context, or
selection changes, and streams run-console lines (`mcp_push_log`) into a bounded
ring buffer. The socket server reads that snapshot per request and, for Android
screenshots, resolves a fresh device capture through the core `adb` helper
(`android::capture_screenshot`). The 11 existing `vm_*` IPC commands are untouched.

## Discovery

PickForge injects these into every embedded terminal once a project's endpoint is
up (the server starts when a project becomes active in the workbench):

- `PICKFORGE_IPC_ENDPOINT` — the live Unix-socket path.
- `PICKFORGE_PROJECT_ROOT`, `PICKFORGE_CONTEXT_DIR`.

On run start the endpoint is also written to `<context_dir>/ipc.sock-path`, so an
adapter launched outside the embedded shell can still find it. The adapter
resolves the endpoint with this precedence:

1. `PICKFORGE_IPC_ENDPOINT` (used directly).
2. `PICKFORGE_CONTEXT_DIR` → read `<dir>/ipc.sock-path`.
3. legacy `<PICKFORGE_PROJECT_ROOT or cwd>/.pickforge/ipc.sock-path`.

The socket lives at `$XDG_RUNTIME_DIR/pickforge-<pid>/agent.sock` (temp-dir
fallback). Windows named-pipe transport is deferred — desktop targets Linux/macOS
first.

## Wiring an agent (opt-in)

The endpoint is discoverable but never auto-attached. To let an agent use it,
point its MCP config at the `pickforge-mcp` adapter — see `examples/mcp/`:

- **Claude Code**: copy `examples/mcp/.mcp.json` to your project root and set the
  `command` to the `pickforge-mcp` binary (it ships in the same Cargo build as the
  app: `target/<profile>/pickforge-mcp`). No `env` block is needed — the embedded
  terminal already carries `PICKFORGE_*`.
- **Codex**: add the `examples/mcp/codex-config.toml` `[mcp_servers.pickforge]`
  block to `~/.codex/config.toml`.

Because the adapter inherits the terminal's env, the *same* config works whether
storage is project-local, Home, or custom.

## Local trust boundary & disabling

The endpoint shares the rest of PickForge's IPC trust boundary: a Unix socket on
the same machine, no auth, no network. To disable it, simply don't add the MCP
config to your agent — nothing connects on its own. The server stops and removes
its socket on `mcp_stop`.

## Deliberately minimal / deferred

- One protocol dialect (MCP JSON-RPC) end-to-end; no separate IPC verb set.
- Web (`cdp`) selection and an `hot_reload` tool are not implemented — the four
  tools the issue names are the surface.
- Windows named pipes, a per-tool auth layer, and any remote transport are out of
  scope by design.
