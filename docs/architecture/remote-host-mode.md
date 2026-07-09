# Remote Host Mode

Remote Host Mode is the foundation for per-project remote hosts. A project can
attach one remote machine, and opening that project should route execution for
agent chats, terminals, `flutter run`, and device work to that machine over the
tailnet.

This is not a suite-wide remote mode. The remote relationship belongs to a
specific project, and the remote machine remains the source of truth for that
project's commands, devices, credentials, terminal state, transcripts, and
context files.

## First Testable Slice

This PR adds the local foundation for that project-attached flow:

- `crates/pickforge-core/src/remote/` defines a versioned remote protocol,
  pairing code exchange, persisted revocable client-token records, daemon
  config, a loopback-only HTTP listener, and Tailscale status/SSH helpers.
- `crates/pickforged/` can start the listener from the CLI, issue pairing codes,
  list/revoke clients, report Tailscale status, and toggle Tailscale SSH.
- Settings can start/stop the in-process listener, issue and copy a pairing
  code, inspect Tailscale status, and toggle Tailscale SSH.

There is still no database sync or MCP network exposure in this slice. The
listener exposes only `HostInfo`,
pairing exchange, token authentication, and self-revocation. Other remote
capabilities stay unadvertised until their typed adapters exist.

## Transport Story

Tailscale SSH is the single remote transport for exec and PTY work. PickForge
does not run an embedded SSH server; it relies on `tailscale set
--ssh=true|false` and the remote machine's own SSH environment.

Structured agent chats on a bound project run the V1 agent CLIs over that SSH
transport and stream their existing JSON events back to the local UI. The V2
bridge and app-server engines remain local-only until their long-lived protocol
can be remoted safely.

`pickforged` handles pairing, discovery, and health over its HTTP listener. In
this slice that listener is loopback-only for local testing. When per-project
attach lands, the listener must remain tailnet-only and must never be exposed on
a public interface.

Remote credentials stay on the remote machine. Local clients receive only
revocable PickForge pairing tokens for the remote protocol.

## Local Test Path

Start from the app Settings screen or from the CLI:

```bash
cargo run -p pickforged -- serve --listen 127.0.0.1:4747
cargo run -p pickforged -- pair
cargo run -p pickforged -- tailscale-status
cargo run -p pickforged -- tailscale-ssh-on
```

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
- The daemon listener must stay loopback-only in this slice and tailnet-only for
  remote attach. Public listeners are never allowed.
- Tailscale SSH is the only remote execution transport for exec/PTY.
- MCP remains a Unix-socket-only local sidecar.
- Remote credentials, project secrets, and tool auth stay on the remote machine.

## Next: Per-Project Attach

Epic #144 R1 attaches a host to a project. That is the next step: persist the
project-to-host relationship, open the project through that host, and route the
project's execution surfaces through the remote adapters instead of the local
Tauri command path.
