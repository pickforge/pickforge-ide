# Pickforge MCP Integration

Pickforge ships the app-local IPC backend for MCP integrations. The MCP server
adapter itself should live outside the Flutter desktop app and proxy calls to
Pickforge through this IPC contract.

This keeps the desktop app free of agent-host packaging concerns while still
giving agent profiles one stable project-local discovery mechanism.

## Discovery

When a run session is active, Pickforge writes the IPC endpoint to:

```text
<projectRoot>/.pickforge/ipc.sock-path
```

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
- `capture_screenshot`: captures the active device screen into `.pickforge/`
  when the current target supports screenshots.
- `hot_reload`: delegates to the active `flutter run` session.
- `get_run_logs`: returns the active project in-memory run log entries.
- `get_project_context`: returns `.pickforge` text context files plus screenshot
  file metadata.

Compatibility aliases are also supported for existing consumers:

- `hotReload`
- `hotRestart`
- `getVmServiceUri`
- `getCurrentSelection`

## MCP Adapter Guidance

Agent profiles should configure an MCP server whose working directory is the
Flutter project root. The adapter should:

1. Read `.pickforge/ipc.sock-path`.
2. Connect using Unix socket or Windows named pipe transport based on the path.
3. Expose MCP `tools/list` entries matching the six MCP-facing methods above.
4. On MCP `tools/call`, forward the tool name to Pickforge as the IPC `method`
   and wrap the JSON result into the MCP tool result content.

Profile-specific configuration should only differ in the host application's MCP
configuration format. The Pickforge discovery file and tool names stay the same
for Codex, OpenCode, and other agent hosts.
