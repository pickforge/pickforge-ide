# Pickforge MCP Integration

Pickforge ships the app-local IPC backend for MCP integrations plus a small
stdio MCP adapter at `tool/pickforge_mcp.dart`. The adapter proxies MCP tool
calls to Pickforge through this IPC contract.

This keeps the desktop app free of agent-host packaging concerns while still
giving agent profiles one stable project-local discovery mechanism. Packaged
agent-host integrations can either call this adapter or reimplement the same
IPC proxy contract.

## Discovery

When a run session is active, Pickforge writes the IPC endpoint to the
resolved context dir's `ipc.sock-path`. In project-local storage mode this is:

```text
<projectRoot>/.pickforge/ipc.sock-path
```

In home/custom storage modes the context dir lives outside the project, so the
adapter resolves the endpoint with the following precedence:

1. `PICKFORGE_IPC_ENDPOINT` — when set and non-empty, it is already the live
   socket path and is used directly.
2. `PICKFORGE_CONTEXT_DIR` — when set, read `<that>/ipc.sock-path`.
3. Otherwise, resolve the project's storage layout and read its
   `ipc.sock-path`.

Pickforge injects `PICKFORGE_CONTEXT_DIR` (and `PICKFORGE_IPC_ENDPOINT` while a
run session is active) into every embedded terminal, so adapters launched from
the embedded shell discover the endpoint without re-resolving storage.

On Linux and macOS the endpoint is a Unix socket:

```text
$XDG_RUNTIME_DIR/pickforge-<pid>/agent.sock
```

If `XDG_RUNTIME_DIR` is not available, Pickforge falls back to the system temp
directory. On Windows, the endpoint is a named pipe:

```text
\\.\pipe\pickforge-<pid>-agent
```

The file is removed when the run session unbinds. Agent MCP adapters should read
the endpoint from the project root they are launched in, connect to the socket
or named pipe, and send newline-delimited JSON requests.

## IPC Request Shape

```json
{"id":1,"method":"get_selected_widget"}
```

Successful responses include the same `id` and a JSON-safe `result` value:

```json
{"id":1,"result":{"node":{"className":"ElevatedButton"}}}
```

Errors include an `error` string:

```json
{"id":1,"error":"no_active_session"}
```

## Methods

The MCP-facing method names are:

- `get_selected_widget`: returns the active inspector selection as
  `SelectedWidget.toJson()`, or `null`.
- `list_pickforge_history`: returns recent pick-history rows for the active
  project.
- `capture_screenshot`: captures the active device screen into the resolved
  context directory when the current target supports screenshots.
- `hot_reload`: delegates to the active `flutter run` session.
- `get_run_logs`: returns the active project in-memory run log entries.
- `get_project_context`: returns the resolved context directory's text context
  files plus screenshot file metadata.

Compatibility aliases are also supported for existing consumers:

- `hotReload`
- `hotRestart`
- `getVmServiceUri`
- `getCurrentSelection`

## Bundled Stdio Adapter

Run from a Flutter project root while Pickforge has an active run session. The
adapter discovers the endpoint via the env-based precedence above
(`PICKFORGE_IPC_ENDPOINT` → `PICKFORGE_CONTEXT_DIR` → resolved storage), so it
works regardless of whether the context dir is project-local, Home, or custom:

```bash
/path/to/pickforge/scripts/pickforge_mcp.sh
```

Use the wrapper script rather than `fvm dart run` in MCP host configuration:
some Flutter/FVM hooks print build status to stdout, and MCP stdio requires
stdout to contain only JSON-RPC messages. The wrapper compiles the adapter under
`build/mcp/` and redirects compiler output to stderr before executing it.

The adapter implements:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

Tool calls are forwarded to Pickforge as IPC requests. Tool results are returned
as MCP text content containing pretty-printed JSON.

## MCP Adapter Guidance

Agent profiles should configure an MCP server whose working directory is the
Flutter project root. The adapter should:

1. Resolve the endpoint via `PICKFORGE_IPC_ENDPOINT`, then `PICKFORGE_CONTEXT_DIR`
   (`<dir>/ipc.sock-path`), then the project's resolved storage layout. Do not
   assume a `.pickforge/` directory exists in the project root.
2. Connect using Unix socket or Windows named pipe transport based on the path.
3. Expose MCP `tools/list` entries matching the six MCP-facing methods above.
4. On MCP `tools/call`, forward the tool name to Pickforge as the IPC `method`
   and wrap the JSON result into the MCP tool result content.

Profile-specific configuration should only differ in the host application's MCP
configuration format. The Pickforge discovery file and tool names stay the same
for Codex, OpenCode, and other agent hosts.
