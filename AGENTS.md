# Pickforge Repository Instructions

These instructions apply to the entire repository. They are inferred from the
current codebase and should override personal/global defaults when they conflict.

## Project overview

Pickforge is a local desktop app for selecting widgets in a running Flutter app,
writing widget context into `.pickforge/`, and pasting that context into an
embedded terminal. The terminal is shell-first: it runs the user's `$SHELL` in
the project root, with quick-launch chips that type agent CLI commands
(claude/codex/…) for the user to run.

It is built on **Tauri v2**: a UI-agnostic Rust core, a Tauri shell that adapts
the core to IPC, and a SolidJS frontend. (The app targets Flutter projects; it is
no longer itself written in Flutter — that was migrated away. See
`plans/rust-migration/`.)

## Tooling

- Frontend/build is bun + Vite; the native side is a Cargo workspace.
- Standard checks:
  - `bun run build` — `tsc --noEmit && vite build`
  - `cargo check` — whole workspace
  - `cargo test -p pickforge-core` — core unit/integration tests
  - `bun run vrt` — Playwright visual regression tests
- Develop: `bun install`, then `bun run tauri dev` (builds the Rust shell + serves
  the Vite frontend). Requires a Rust toolchain (`rustup`) and Bun 1.2+.
- Don't hand-edit generated output under `src-tauri/gen/`.

## Architecture

- `crates/pickforge-core/` — UI-agnostic Rust core. Modules: `pty`, `process`,
  `transcript`, `storage`, `targets`, `inspector`, `db`, `android`, `vm_service`.
  Keep platform/process/PTY/db logic here, not in the Tauri binary or the UI.
- `src-tauri/` — the Tauri v2 binary. `src/*_commands.rs` adapt the core to IPC
  (`pty_commands`, `process_commands`, `db_commands`, `device_commands`,
  `fs_commands`, `vm_commands`). `capabilities/default.json` scopes IPC
  (default-deny — add new commands there). `tauri.conf.json` is the app manifest.
- `src/` — SolidJS frontend.
  - `screens/` — `Onboarding`, `Settings`, `History`, `RunHistory`, and
    `workbench/` (Workbench, InspectorPanel, ProjectsChatsPanel, FileExplorer).
  - `components/` — `Terminal`, `TerminalHost`, shared `ui`.
  - `lib/` — IPC/client helpers (`pty`, `db`, `device`, `vm`, `process`,
    `agentModels`, `terminal-theme`). Prefer these seams over inlining IPC calls.
  - `stores/` — app state (`workspace`). `router.ts` is the route table.
  - `styles/` — `tokens.css`, `fonts.css`, `global.css`.

## Design system & branding

PickForge has a first-class design system — read
[`docs/design-system/`](docs/design-system/README.md) before any UI work, and
keep new UI consistent with it.

- **Tokens only — never raw values.** Use the CSS custom properties in
  `src/styles/tokens.css` (color, spacing, radii, motion). No raw hex, font
  sizes, radii, or durations in components.
- **One ember per composition.** The ember accent is the only accent — reserve it
  for the single most important element (primary CTA, active/selected, live
  status). Everything else is surface / text / hairline / semantic status.
- **Type:** Geist is the default; Geist Mono is the machine voice. Fonts ship in
  `public/fonts/` and are wired in `src/styles/fonts.css`.
- **Motion uses one easing** and every animation honors reduced motion.
- **Embedded terminal:** Claude/Codex must render with correct colors and no stray
  underlines — see [`docs/design-system/terminal.md`](docs/design-system/terminal.md)
  and `src/lib/terminal-theme.ts`.
- **Verify visuals via VRT.** After UI changes run `bun run vrt` and review the
  Playwright snapshots under `tests/vrt/` before committing.

## Testing

- Rust: unit tests live beside their modules in `crates/pickforge-core/`;
  integration tests in `crates/pickforge-core/tests/`.
- Frontend: Playwright VRT specs and baselines live under `tests/vrt/`.

Canonical brand assets live in `assets/branding/`.
