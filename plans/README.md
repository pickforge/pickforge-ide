# Implementation Plans

Generated on 2026-06-15. The source-of-truth roadmap is:

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 001 | Make PickForge a multi-framework local agent suite | P1 | XL | — | WIP — Milestone 1 (configurable context storage) complete; suite green (858), Codex-reviewed. Milestones 2–10 remain. |
| 002 | Agent chat GUI (Claude Code + Codex, structured chat) | P1 | XL | — | Draft — research done (protocols verified against installed CLIs), v1–v3 phased. |
| 003 | Suite monetization | P2 | M | 002 | Source of truth - one Forge Pass; official builds and updates stay free; PickArena stays unpaywalled. |

Update `plans/001-multi-framework-agent-suite-roadmap.md` as tasks land.

## Rust migration

| Track | What | Status |
| --- | --- | --- |
| [`rust-migration/`](rust-migration/README.md) | Move the OS-heavy layer to a Rust core. Two specs: Option A (keep Flutter UI via `flutter_rust_bridge`) and Option B (Tauri hybrid, web UI). | **Option B chosen + implemented** — Rust core + SolidJS app under [`tauri/`](../tauri/), merged to main (2026-06-17). 60 core tests, `.deb`/`.rpm` packaging, Playwright VRT. |
