# PickForge

Tauri v2 desktop app. Rust core in `crates/pickforge-core`, Tauri shell in `src-tauri`, SolidJS frontend in `src`. It runs your mobile or web project, lets you pick an on-screen element, and forges its context into an agent CLI.

`bun install`, then `bun run tauri dev`. Needs a Rust toolchain. Run `bun run sidecar` once per worktree before any cargo command; the `src-tauri` build script resolves the sidecar binaries and fails without them.

Before pushing, run what CI runs:

```
bun run lint && bun run build && bun run test:unit && bun run test:coverage
bun run e2e && bun run vrt
cargo test --workspace --locked --all-targets
cargo clippy --workspace --all-targets -- -D warnings
```

The `run` skill in `.agents/skills/run` explains how to launch an isolated copy for screenshots without hijacking your real window.

Things you can't guess:

- New Tauri commands go in `generate_handler!` only. Adding one to `src-tauri/capabilities/default.json` flips the app to default-deny and breaks every command that wasn't migrated with it.
- VRT baselines are CI-rendered Linux PNGs. Regenerate with `gh workflow run update-vrt-baselines.yml --ref <branch>`, never commit local ones. `bun run vrt` reuses whatever already serves port 1420, so stop other dev servers first.
- A Rust migration that backfills or rewrites data must also run from `reconcile_data` in `crates/pickforge-core/src/db/mod.rs`. Databases at `user_version <= 10` skip the numbered migrations entirely. This shipped as a bug twice.
- Rust tests that touch `HOME` or `PICKFORGE_HOME` must hold `test_support::PICKFORGE_HOME_ENV_LOCK` and restore what they set.
- Styling is plain CSS with `--pf-*` tokens from `@pickforge/brand`, and ESLint is the gate here, not oxlint. Lint also rejects raw easing curves.
- Coverage floors in `vitest.config.ts` and `--fail-under-lines 75` in CI are gates, not suggestions.
