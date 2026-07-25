# Pickforge Repository Instructions

These instructions apply to the entire repository. They are inferred from the
current codebase and should override personal/global defaults when they conflict.

## Project overview

Pickforge is a local desktop app for selecting on-screen elements in a running
app — Flutter (deep), React Native and native Android (useful), web
(experimental) — writing the selected element's context into `.pickforge/`, and
pasting that context into an embedded terminal. The terminal is shell-first: it
runs the user's `$SHELL` in the project root, with quick-launch chips that type
agent CLI commands (claude/codex/…) for the user to run.

It is built on **Tauri v2**: a UI-agnostic Rust core, a Tauri shell that adapts
the core to IPC, and a SolidJS frontend. (The app targets mobile and web
projects, not only Flutter; it is no longer itself written in Flutter — that was
migrated away. See `plans/rust-migration/`.)

## Tooling

- Frontend/build is bun + Vite; the native side is a Cargo workspace.
- Standard checks:
  - `bun run build` — `tsc --noEmit && vite build`
  - `bun run test:unit` — deterministic frontend unit tests
  - `bun run test:coverage` — frontend coverage ratchet
  - `bun run e2e` — device-free run-command smoke unless a serial is explicitly set
  - `cargo check` — whole workspace
  - `cargo test --workspace --locked --all-targets` — Rust workspace tests
  - `cargo llvm-cov --workspace --locked --all-targets` — Rust coverage ratchet
  - `bun run vrt` — Playwright visual regression tests
- Develop: `bun install`, then `bun run tauri dev` (builds the Rust shell + serves
  the Vite frontend). Requires a Rust toolchain (`rustup`) and Bun 1.2+.
- When handing a worktree build to someone for manual testing, make the running
  app visibly identifiable. Prefer a small Tauri flavor config and script that
  keep the normal dev path unchanged while using a different dev-server port and
  a semver prerelease suffix tied to the work, for example
  `v0.1.7-performance`. The app's title bar/version badge should make it obvious
  which branch or fix is under test when multiple PickForge windows are open.
- Don't hand-edit generated output under `src-tauri/gen/`.
- Write tests in the same PR as behavior changes. For bugs, start with a
  failing regression test when practical. For risky refactors, add
  characterization tests first.
- Do not lower coverage thresholds without explicit maintainer approval.

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

- A TypeScript change is not validated by `bun run test:unit` + `bun run lint`
  alone — neither type-checks. Always include `bunx tsc --noEmit` (or
  `bun run build`) in the validation pass (#329 review: a wrong-arity call
  passed tests and lint, failed only at build).
- When renaming or retiring an agent model id, grep for the version digits in
  free text too (`"opus 4.8"`, alias term arrays, swarm command parsing) — the
  exact-id grep misses natural-language sites — and migrate persisted
  selections (`RETIRED_MODELS` in `src/lib/agentModels.ts`).
- Rust: unit tests live beside their modules in `crates/pickforge-core/`;
  integration tests in `crates/pickforge-core/tests/`.
- Frontend: Playwright VRT specs and baselines live under `tests/vrt/`.
- Any Rust test that mutates process-level home/env state (`HOME`,
  `PICKFORGE_HOME`) must take `test_support::PICKFORGE_HOME_ENV_LOCK` for
  its whole mutation scope and restore every var it touched via an
  `EnvRestore`/`EnvRestore::capture_many` RAII guard — two independent locks,
  or any unguarded mutation of that state in the same test binary, is a
  known flake class where one test's panic poisons the lock and cascades
  failures into every other test asserting on it (#237 review, PR #257 CI).
- Code or tests gated `#[cfg(target_os = "linux")]` must be validated on
  real Linux (a throwaway container is enough) before pushing — macOS runs
  structurally cannot exercise them, and every one of the last three
  macOS-only validation passes over such code shipped a bug straight to CI
  or production (PR #257 graphics tests; PR #259 twice: an inverted
  liveness hint and an unmatched tmux "never created" phrasing).
- Connector capability gating (native chat ready, etc.) must derive only
  from errors of capability-relevant probe steps. Optional/advisory steps
  (model catalog, extension detection) report through their own advisory
  path and never withhold the capability — adding a probe step to the
  shared error list silently disables the connector (#285 review).

Canonical brand assets live in `assets/branding/`.

## Releasing

- Keep [`docs/releases/UNRELEASED.md`](docs/releases/UNRELEASED.md) current on
  PRs with user-facing or release-relevant changes. Track user-facing changes,
  internal/release changes, what was tested, what was not tested yet, and known
  blockers. At release time, copy and polish it into the GitHub release
  description, then reset the draft.
- Bump the version in `src-tauri/tauri.conf.json` and `package.json`, land it on
  `main`, then tag `vX.Y.Z` and push the tag. CI builds installers for every
  platform, signs the updater artifacts, and creates a **draft** release —
  review it, polish the notes, and publish.
- The GitHub release description is the single source of release notes. The
  website (pickforge.dev/pickforge) reads the latest release from the GitHub
  API in the browser, so a normal release needs **no website change**.
- Only touch `landing-page` (`src/pages/products.ts`) when install methods,
  supported platforms, or positioning change.
## Workspace policy

For substantial work, read `../AGENTS.md` (workspace root) and use the `plan-issue` workflow — GitHub Issues are the canonical plan/progress tracker.
