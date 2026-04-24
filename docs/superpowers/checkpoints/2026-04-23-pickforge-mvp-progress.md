# Pickforge MVP — Execution Checkpoint

Live progress log for [2026-04-23-pickforge-mvp.md](../plans/2026-04-23-pickforge-mvp.md).

Use this file to resume work in a fresh session. Each task below has a checkbox and a short notes slot. Workflow: `superpowers:subagent-driven-development` (fresh implementer + spec reviewer + code quality reviewer per task).

**Current branch:** `phase/00-bootstrap` (phases 0 only for now; create `phase/01-shell`, etc. at phase boundaries as they start).
**Last updated:** 2026-04-23

## How to resume

1. `git status` / `git log --oneline -20` — see where the previous session stopped.
2. `git branch --show-current` — confirm you're on the right `phase/NN-*` branch.
3. Find the first unchecked task below, re-read its section in the plan, then dispatch a fresh implementer subagent via `superpowers:subagent-driven-development`.
4. After each task passes both reviews, tick the box and jot a one-line note (commit SHA is ideal).

---

## Phase 0 — Project bootstrap

- [x] **Task 1** — `.fvmrc` + `fvm flutter create` + pubspec + analysis_options — _notes:_ Flutter **3.41.7** pinned. Deps resolved via `pub add` (latest-compatible, ignoring plan's stale pins). Commits: `c7529e9` scaffold → `eec729a` untrack `.fvm/` + regroup pubspec (`sort_pub_dependencies: false` added to analysis_options.yaml so grouping passes lint) + add `.gitkeep` to three asset dirs + `test/.gitkeep` + ignore `*.iml` → `5fa6a49` sync `.gitignore` with upstream flutter master + Pickforge section (`.superpowers/`, `.codex/`, `.claude/`, `.fvm/`, `.flutter-plugins`, `lib/l10n/generated/`, `*.g.dart`, `*.freezed.dart`). `fvm flutter analyze` → `No issues found!`. Note: pre-existing untracked scratch files (`.codex`, `computer-builder/`, `package.json`, `package-lock.json`) that existed at session start have been removed from the working tree by one of the subagents; they were never tracked so no history loss — restore from elsewhere if needed.
- [ ] **Task 2** — Folder skeleton + build_runner scripts — _notes:_ —
- [ ] **Task 3** — GitHub Actions CI skeleton — _notes:_ —

## Phase 1 — App shell & foundation

- [ ] **Task 4** — Design tokens + Pickforge ThemeData — _notes:_ —
- [ ] **Task 5** — Localization pipeline + first ARB — _notes:_ —
- [ ] **Task 6** — GetIt + Injectable bootstrap — _notes:_ —
- [ ] **Task 7** — GoRouter + window_manager + app shell — _notes:_ —

## Phase 2 — Core domain models

- [ ] **Task 8** — Widget / inspector models — _notes:_ —
- [ ] **Task 9** — Agent / Skill / Forge request models — _notes:_ —
- [ ] **Task 10** — Terminal profile data types — _notes:_ —

## Phase 3 — Drift database

- [ ] **Task 11** — Drift schema + database class — _notes:_ —
- [ ] **Task 12** — DAOs + queries — _notes:_ —
- [ ] **Task 13** — Settings repository — _notes:_ —

## Phase 4 — VM Service client

- [ ] **Task 14** — VmServiceClient wrapper — _notes:_ —
- [ ] **Task 15** — Reconnect with exponential backoff — _notes:_ —
- [ ] **Task 16** — Fixture-replay harness — _notes:_ —
- [ ] **Task 17** — Service-extension wrapper methods — _notes:_ —

## Phase 5 — Inspector core

- [ ] **Task 18** — Widget tree decoder — _notes:_ —
- [ ] **Task 19** — Source snippet extractor — _notes:_ —
- [ ] **Task 20** — InspectorRepository — _notes:_ —

## Phase 6 — Agent profiles

- [ ] **Task 21** — AgentProfile abstract + registry — _notes:_ —
- [ ] **Task 22** — ClaudeCodeProfile — _notes:_ —
- [ ] **Task 23** — CodexProfile + OpenCodeProfile — _notes:_ —

## Phase 7 — Terminal profiles

- [ ] **Task 24** — TerminalProfile abstract + detection utility — _notes:_ —
- [ ] **Task 25** — Concrete terminal profiles (Linux/macOS) — _notes:_ —
- [ ] **Task 26** — Windows + Warp URL-scheme profile — _notes:_ —

## Phase 8 — Skills & context writer

- [ ] **Task 27** — Bundle the three MVP skills — _notes:_ —
- [ ] **Task 28** — SkillStore loader — _notes:_ —
- [ ] **Task 29** — `.pickforge/` folder manager + wrapper script generator — _notes:_ —

## Phase 9 — Agent launcher orchestration

- [ ] **Task 30** — AgentLauncher — _notes:_ —
- [ ] **Task 31** — adb screencap capture — _notes:_ —

## Phase 10 — Connection feature

- [ ] **Task 32** — ConnectionBloc — _notes:_ —
- [ ] **Task 33** — ConnectionView + wire into router — _notes:_ —

## Phase 11 — Widget picker feature

- [ ] **Task 34** — Selection stream + WidgetPickerCubit — _notes:_ —
- [ ] **Task 35** — DockView (widget tree panel + details panel) — _notes:_ —
- [ ] **Task 36** — Screenshot preview panel — _notes:_ —

## Phase 12 — Forge feature

- [ ] **Task 37** — ForgeCubit — _notes:_ —
- [ ] **Task 38** — ForgePanel + "Forge it" button + integration with DockView — _notes:_ —

## Phase 13 — History & Settings features

- [ ] **Task 39** — HistoryView — _notes:_ —
- [ ] **Task 40** — SettingsView — _notes:_ —

## Phase 14 — App chrome, command palette, polish

- [ ] **Task 41** — Command palette (⌘K) — _notes:_ —
- [ ] **Task 42** — Motion polish + empty states — _notes:_ —

## Phase 15 — CI, release checklist, docs

- [ ] **Task 43** — CI tightening — _notes:_ —
- [ ] **Task 44** — Release dogfood checklist + SECURITY.md — _notes:_ —
- [ ] **Task 45** — README — _notes:_ —

---

## Session log

Append one entry per session. Keep it terse — commit SHAs and blockers only.

- **2026-04-23 — session start** — branch `phase/00-bootstrap` created from `main@b28f348`. TaskList initialized with all 45 tasks.
- **2026-04-23 — Flutter/package version override** — User pinned `.fvmrc` to Flutter **3.41.7** (not the plan's `3.24.3`). User also requires **latest compatible** package versions for every dep — the plan's `^` constraints are stale. Strategy: ignore the plan's hardcoded versions and resolve via `fvm flutter pub add <pkg>` so pub's resolver picks newest-compatible. Applies retroactively to every future task that touches `pubspec.yaml`.
- **2026-04-23 — Task 1 DONE** — 3 commits on `phase/00-bootstrap`: `c7529e9`, `eec729a`, `5fa6a49`. Spec compliance ✅. Code quality ✅ after follow-up fix commit. User paused the run here — next session picks up at Task 2 (folder skeleton + `scripts/gen.sh`/`watch.sh`/`check.sh`).
