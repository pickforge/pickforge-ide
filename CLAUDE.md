# PickForge — instructions for Claude

The repository conventions live in [`AGENTS.md`](AGENTS.md) — read it first;
everything there applies to you.

## Quick reference

- **Tooling:** Tauri v2 — bun + Vite frontend over a Cargo workspace. Develop
  with `bun install` then `bun run tauri dev`. Standard checks: `bun run build`
  (`tsc --noEmit && vite build`), `cargo check`, `cargo test -p pickforge-core`,
  `bun run vrt` (Playwright). Don't hand-edit generated output under
  `src-tauri/gen/`.
- **Architecture:** Rust core in `crates/pickforge-core/` (pty, process,
  transcript, storage, targets, inspector, db), Tauri binary in `src-tauri/`
  (`*_commands.rs` adapt the core to IPC; `capabilities/default.json` scopes it),
  SolidJS UI in `src/` (`screens/`, `components/`, `lib/`, `stores/`, `styles/`).

## Design system (do this before touching UI)

Read [`docs/design-system/`](docs/design-system/README.md). The ten rules in its
README are binding. In short:

1. Tokens only — no raw hex / sizes / radii / durations; use `src/styles/tokens.css`.
2. One ember per composition (the single accent token).
3. Geist is the default font; Geist Mono is the machine voice (`src/styles/fonts.css`).
4. Compose with the shared components in `src/components/` before hand-rolling UI.
5. One easing; every animation honors reduced motion.
6. Embedded terminal must render Claude/Codex with correct colors and no
   underlines (`docs/design-system/terminal.md`, `src/lib/terminal-theme.ts`).
7. Verify UI with the Playwright VRT snapshots (`tests/vrt/`), reviewing the PNGs.

## Agent models

The embedded terminal is shell-first (it spawns `$SHELL`, never an agent).
Quick-launch chips type agent commands pinned to fast models by default
(Claude → Haiku 4.5, Codex → GPT-5.3 Codex Spark) via
`src/lib/agentModels.ts` and the Settings → "Agent models" picker. Prefer these
(and GPT-5.4 Mini) for testing/dogfooding to keep runs cheap.
