# Remote Host Mode

PickForge Remote Host Mode is a tailnet-only thin client. The host remains the
source of truth for projects, chats, terminals, agents, devices, SQLite, context
directories, transcripts, and MCP. The client keeps only the last host and its
revocable app-level token.

## First Foundation Slice

This PR adds only the foundation:

- `crates/pickforge-core/src/remote/` defines a versioned remote protocol,
  pairing code exchange, revocable client-token records, and daemon config.
- `crates/pickforged/` adds the daemon entrypoint, but it starts with no listener.
- Local desktop behavior is unchanged.

There is no public listener, no `0.0.0.0` bind, no database sync, and no MCP
network exposure in this slice.

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
- A daemon listener, when implemented, must bind loopback only and rely on
  Tailscale Serve HTTPS for tailnet access.
- MCP remains a Unix-socket-only local sidecar.
