# PickForge MCP configs

Opt-in MCP configs that wire an embedded agent to PickForge's local MCP endpoint
(selection / screenshot / run logs / project context). See
[`docs/architecture/pickforge-mcp.md`](../../docs/architecture/pickforge-mcp.md).

- `.mcp.json` — Claude Code. Copy to your project root, set `command` to the
  `pickforge-mcp` binary.
- `codex-config.toml` — Codex. Add the block to `~/.codex/config.toml`.

The `pickforge-mcp` adapter ships with the app as a Tauri sidecar
(`bundle.externalBin`), installed next to the main `PickForge` executable; in a
dev/source build it is `target/<profile>/pickforge-mcp` from the same Cargo
workspace. It discovers the live endpoint from the `PICKFORGE_*` env the embedded
terminal already sets, so no `env` block is needed. Nothing connects unless you
add one of these configs — the endpoint is local-only and never auto-attached.
