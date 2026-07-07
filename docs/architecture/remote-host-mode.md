# Remote Host Mode

PickForge Remote Host Mode is a tailnet-only thin client. The host remains the
source of truth for projects, chats, terminals, agents, devices, SQLite, context
directories, transcripts, and MCP. The client keeps only the last host and its
revocable app-level token.

## First Testable Slice

This PR adds the first local-hosted remote path:

- `crates/pickforge-core/src/remote/` defines a versioned remote protocol,
  pairing code exchange, persisted revocable client-token records, daemon
  config, a loopback-only HTTP listener, and fixed Tailscale helpers.
- `crates/pickforged/` can start the same listener from the CLI, issue pairing
  codes, list/revoke clients, and report Tailscale status.
- Settings can start/stop the in-process listener, issue a pairing code, inspect
  Tailscale status, and explicitly run Tailscale Serve or Tailscale SSH toggles.

There is still no `0.0.0.0` bind, no database sync, no MCP network exposure, and
no remote terminal/agent streaming in this slice. The listener exposes only
`HostInfo`, pairing exchange, token authentication, and self-revocation. Other
remote capabilities stay unadvertised until their typed adapters exist.

## Local Test Path

Start from the app Settings screen or from the CLI:

```bash
cargo run -p pickforged -- serve --listen 127.0.0.1:4747
cargo run -p pickforged -- pair
```

Expose the loopback listener inside the tailnet:

```bash
cargo run -p pickforged -- tailscale-serve --listen 127.0.0.1:4747 --https-port 443
```

The helper runs `tailscale serve --bg --https=<port> --set-path /pickforge
http://127.0.0.1:<port>`. Tailscale SSH remains host-level state; PickForge can
toggle `tailscale set --ssh=true|false`, but it does not run an embedded SSH
server.

## IPC Surface Map

The current local app uses Tauri commands plus a few high-volume channels:

| Local surface | Transport shape | Remote boundary |
| --- | --- | --- |
| `pty_*` | `invoke` control plus output/exit `Channel`s | Host-owned terminal sessions; client sends typed terminal actions, never raw command names. |
| `agent_chat_*` | `invoke` plus event `Channel` | Host-owned agent sessions with typed chat events. |
| `mirror_*`, `logcat_*`, `oslog_*` | streaming `Channel`s | Future read-only streams behind explicit device/session capability. |
| `vm_*`, `cdp_*`, `device_*` | request/response `invoke`s | Narrow inspector/device methods, gated by paired client auth. |
| `projects_*`, `chats_*`, `runs_*`, `settings_*` | request/response `invoke`s | Workspace read/write methods over host state; one active writer later. |
| `fs_*`, `git_*`, `process_*` | request/response `invoke`s with local gates | Host-side path and approved-root checks stay authoritative. |
| `mcp_*` and `pickforge-mcp` | local Unix socket and stdio adapter | Host-local only. Not part of the remote protocol. |

The remote protocol must not expose raw Tauri command strings. It should expose
typed host capabilities and methods, then adapt to core/local command handlers on
the host side.

## Security Rules

- Pairing starts from a host-visible code and issues a hashed client-token record.
- Tokens are revocable by client id.
- A daemon listener must bind loopback only and rely on Tailscale Serve HTTPS for
  tailnet access.
- MCP remains a Unix-socket-only local sidecar.
