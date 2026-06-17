# Milestone 1 · Slice 1B — Rewire writers to the resolved context dir

Part of `plans/001-multi-framework-agent-suite-roadmap.md`. Depends on Slice 1A
(`lib/core/storage/` is done and green). This slice routes every runtime-context
filesystem path through `ContextStorageService` so non-project-local storage works.

## The safety invariant (this is the whole point)

`ContextStorageService.resolve()` AUTO-DETECTS: a project that already has
`<root>/.pickforge/.gitignore` containing exactly `*\n` resolves to
`projectLocal`, whose `contextDir` is `<root>/.pickforge`, `runsDir` is
`<root>/.pickforge/runs`, `chatsDir` is `<root>/.pickforge/chats`. So **for every
existing project-local project, the rewired paths must be byte-identical to today.**
A clean project (no marker) resolves to `pickforgeHome` (`~/.pickforge/projects/<id>/...`).

**Test-driven**: for each rewired writer, FIRST add a parity test that creates a
`.pickforge/.gitignore` marker in a temp project and asserts the writer targets the
exact legacy `<root>/.pickforge/...` path. Then rewire. The parity test must pass
unchanged. Also add a home-mode test (PICKFORGE_HOME at a temp dir) asserting the
writer targets `<tmpHome>/projects/<id>/...`.

## Architecture decision

Inject `ContextStorageService` into each writer and resolve internally from the
`projectRoot` it already receives (smallest diff; preserves existing `projectRoot`
threading). Replace `await PickforgeProjectDirectory.ensure(projectRoot)` and every
literal `p.join(projectRoot, '.pickforge', ...)` / `'$projectRoot/.pickforge/...'`
with the matching `resolved.contextDir` / `resolved.runsDir` / `resolved.chatsDir`
/ `resolved.ipcSockPath`.

- DI-managed classes: add a constructor param; injectable wires it (run build_runner).
- Ad-hoc-constructed leaves: the construction site (which has `getIt` access) passes
  `getIt<ContextStorageService>()`. Note: a `const Foo()` used as a default param
  value cannot call `getIt` (not const) — change such params to nullable and default
  them inside the constructor body (`x = x ?? Foo(storage)`), threading `storage`
  from the holder's own construction site.

Project invariants (FVM, infra in lib/core, no hand-editing generated files, no new
deps, style) per `plans/m1-slices/1a-storage-core.md` apply.

## Rewire targets (replace literal `.pickforge` with resolved dirs)

1. **`lib/core/agent/pickforge_context_writer.dart`** (`@lazySingleton`): inject
   `ContextStorageService`; `final resolved = await _storage.ensure(projectRoot);
   final dir = Directory(resolved.contextDir);`. Files (`skill-active.md`,
   `widget-context.md`, `initial-prompt.md`, `screenshot.png`, `device-screen.png`)
   under `dir.path`. Update `test/core/agent/pickforge_context_writer_test.dart` to
   construct it with a `ContextStorageService.forTesting(...)` and add the home-mode
   parity test. (Construction is via `AgentLauncherModule.agentLauncher`.)

2. **`lib/core/inspector/inspector_repository.dart`** (`_captureScreenshot`, ~line 74):
   add a `ContextStorageService` field; replace `ensure(projectRoot)` with
   `(await _storage.ensure(projectRoot)).contextDir` + `screenshot.png`. Construction
   site: `lib/features/widget_picker/widgets/widget_picker_scope.dart:~115` — pass
   `getIt<ContextStorageService>()`.

3. **`lib/core/emulator/run_session_event_log_writer.dart`** (`append`, ~line 17):
   currently `const`, calls `ensure(projectRoot)` then `runs/<sessionId>/log.jsonl`.
   Give it a `ContextStorageService`; use `(await _storage.ensure(projectRoot)).runsDir`
   then `<runsDir>/<sessionId>/log.jsonl`. Holder: `emulator_session_cubit.dart:42`
   default `const RunSessionEventLogWriter()` → nullable + built from the cubit's
   injected `storage`. Update `test/core/emulator/run_session_event_log_writer_test.dart`
   (+ parity + home tests).

4. **`lib/core/emulator/run_session_recovery_store.dart`**: `_fileFor` (~236) and
   `findRecoverable` (~188, the literal `p.join(projectRoot, '.pickforge', 'runs')`)
   and persist/remove. Give it a `ContextStorageService`; use `resolved.runsDir`.
   Holder: `app_shell_view.dart:~184` `const RunSessionRecoveryStore()`. Keep the
   `RunProcessProbe` field. Update `test/core/emulator/run_session_recovery_store_test.dart`.

5. **`lib/core/terminal/transcript_recorder.dart`** + **`transcript_replayer.dart`**:
   build `<root>/.pickforge/chats/<chatId>/...`. Give both a `ContextStorageService`
   (or resolve `chatsDir` in the caller and pass it). `deleteTranscript` is static —
   make it take the resolved `chatsDir` (or accept the service). Construction sites:
   `lib/features/workbench/view/terminal_pane_host.dart` (~335 replayer, ~364 recorder,
   ~328 deleteTranscript) — already uses `getIt`, so resolve there:
   `final chatsDir = (await getIt<ContextStorageService>().resolve(widget.projectRoot)).chatsDir;`
   and pass `<chatsDir>/<chatId>`. `open()` must still ensure the dir exists
   (`storage.ensure` for project-local creates `.pickforge`; for home the chats dir is
   created by `Directory(dir).create(recursive:true)` as today). Update
   `test/core/terminal/` transcript tests (+ parity).

6. **`lib/features/emulator/cubit/emulator_session_cubit.dart`**: `_bindIpc` (~740,
   `ensure(projectRoot)` + `'${dir.path}/ipc.sock-path'`) and `_unbindIpc` (~757,
   literal `'$projectRoot/.pickforge/ipc.sock-path'`). Add a `ContextStorageService`
   constructor param (`storage`), passed from the cubit's construction site via getIt;
   use `resolved.ipcSockPath` for both write and delete. Grep the whole cubit for any
   other `.pickforge` / `PickforgeProjectDirectory.ensure` (there are ensure() calls at
   ~833 and ~852 too — rewire those to the resolved dir as well). Update the cubit test.

7. **`lib/core/inspector/adb_screenshot_capturer.dart`** (`_outputPath`, ~199): it
   branches on `p.basename(outputDir) == '.pickforge'` to decide whether to apply the
   marker rule. For home/custom the leaf dir is `context`, so this branch silently
   stops applying the marker. Change the decision to key off whether `outputDir` is a
   project-local `.pickforge` (i.e. accept a flag or check via the resolved dir from the
   caller) rather than a hard-coded basename. Preferred: the caller passes the resolved
   `contextDir` and an `isProjectLocal` flag; the capturer applies
   `PickforgeProjectDirectory.ensureDirectory` only when `isProjectLocal`, else
   `Directory(outputDir).create(recursive:true)`. Trace the caller(s) of the screenshot
   capture that supply `outputDir` and thread the resolved values. Update
   `test/core/inspector/` capturer tests.

## Slice 1B — OUTCOME (done, full suite green: 809 passed, 3 skipped)

Rewired beyond the original target list (all legitimate `.pickforge`-path sites
found by grepping): `pickforge_mcp_server._readEndpoint` (→ `resolved.ipcSockPath`;
env-var precedence still 1C), `workspace_search_service` + `chats_cubit` (transcript
paths), `forge_cubit` (adb-capture caller threading `outputDir`+`isProjectLocal`),
`pasted_image_store` (+`pastesDir` getter on `ResolvedContextDirectory`), plus all
construction sites. Parity verified byte-identical for project-local; build_runner
idempotent (DI regen clean).

### Follow-ups carried into 1C (do NOT forget)

- `lib/core/skills/skill_store.dart` still reads `$projectRoot/.pickforge/skills/<id>.md`
  (line ~51) and `$projectRoot/.pickforge/prompt-templates` (line ~87) as literals.
  Project-local parity is fine, but home/custom skill+template overrides won't be
  found until this resolves via `ContextStorageService` (home layout includes
  `skills/` + `prompt-templates/`).
- `lib/core/agent/context_attachment_policy.dart:53` matches `'.pickforge/'`
  literally; needs home-mode awareness.

## Explicitly DEFERRED (not this slice)

- Project-level `.gitignore` suggestion (`lib/core/projects/gitignore_helper.dart`) and
  `.pickforge` exclusion in `lib/core/projects/project_file_tree_scanner.dart`. For home
  storage there is no in-repo `.pickforge`, so these become conditional/no-ops — handle
  in Slice 1D (settings/UX) where the storage-mode is user-visible. Leave them as-is now
  (they remain correct for project-local mode).
- Env vars, prompt absolute paths, MCP discovery precedence → Slice 1C.

## Verification (run, fix until green, report exact results)

1. `fvm dart run build_runner build --delete-conflicting-outputs`
2. `fvm dart format .`
3. `fvm flutter analyze` (0 issues)
4. Targeted: `fvm flutter test test/core/agent/ test/core/inspector/ test/core/emulator/ test/core/terminal/ test/core/storage/ test/features/emulator/`
5. Full: `fvm flutter test` (all green, including goldens)

STOP and report (do not guess) if any existing test asserts a `.pickforge` path that
can't be made parity-identical, or if a construction site can't reach a
`ContextStorageService` without a larger refactor than described here.
