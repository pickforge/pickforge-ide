# Milestone 1 · Slice 1C — Env vars, absolute prompt paths, MCP discovery, skill/attachment home-mode

Part of `plans/001-multi-framework-agent-suite-roadmap.md`. Depends on 1A + 1B
(`ContextStorageService` + all writers rewired; full suite green). Project
invariants (FVM, no hand-editing generated files, no new deps, style, shell
gotchas) per `plans/m1-slices/1a-storage-core.md`. Shell: `command grep`, `find`.

Unlike 1B, parts of this slice intentionally CHANGE prompt output (relative →
absolute). Update the affected tests to the new expected output (do not force old
assertions). Project-local filesystem PATHS must still be byte-identical.

## Part A — `PICKFORGE_*` env vars for embedded sessions

The embedded terminal is shell-first; agents inherit its env. Inject these into
every spawned PTY (and they must survive `normalizePtyEnvironment`):

```
PICKFORGE_HOME=<absolute PickForge Home root>
PICKFORGE_PROJECT_ROOT=<absolute project root>
PICKFORGE_CONTEXT_DIR=<absolute resolved contextDir>
PICKFORGE_STORAGE_MODE=home|project-local|custom   (resolved.storageLocation.wireName)
PICKFORGE_IPC_ENDPOINT=<active ipc socket path>     (ONLY when an ipc socket is currently active)
```

Seam: `lib/features/workbench/view/terminal_pane_host.dart` builds `PtySession` in
the `pool.activate(create: ...)` callback (~line 364). `PtySession` threads
`environment` to `FlutterPtyAdapter.start` (`pty_session.dart:72`), where a null env
lazily loads `UserShellEnvironment`. So at the create site:
- resolve once: `final resolved = await getIt<ContextStorageService>().resolve(widget.projectRoot);`
  (you already resolve `chatsDir` here for the recorder/replayer — reuse one resolve).
- build the base shell env: `final base = await UserShellEnvironment.instance.load();`
- merge: `final env = {...base, 'PICKFORGE_HOME': PickforgeHome.resolve(), 'PICKFORGE_PROJECT_ROOT': <abs root>, 'PICKFORGE_CONTEXT_DIR': resolved.contextDir, 'PICKFORGE_STORAGE_MODE': resolved.storageLocation.wireName};`
  Set `PICKFORGE_IPC_ENDPOINT` only if `File(resolved.ipcSockPath).existsSync()` →
  its trimmed contents (the live socket path).
- pass `environment: env` into `PtySession`.
- Keep `normalizePtyEnvironment` a pure function, but ensure it does NOT strip
  `PICKFORGE_*` (it only touches color vars today, so it won't — just confirm).

Prefer a small testable helper, e.g. `Map<String,String> pickforgeEnvVars(ResolvedContextDirectory, {String? activeIpcEndpoint})`
in `lib/core/storage/` (or `lib/core/terminal/`), unit-tested directly, then merged
at the call site. Add a unit test for the helper (all five vars; IPC omitted when no
socket; STORAGE_MODE per mode).

## Part B — Absolute context paths in prompts

`lib/core/agent/agent_launcher.dart:78` passes `pickforgeDirRelative: '.pickforge'`.
Inject `ContextStorageService`, resolve `req.projectRoot`, and pass the ABSOLUTE
`resolved.contextDir` as the dir (the renderer just prefixes it, so absolute paths
fall out). Also fix the visual self-check text (`agent_launcher.dart:129`) to
reference the absolute `resolved.ipcSockPath` and `${resolved.contextDir}/device-screen*.png`
instead of the literal `.pickforge/...`.
- This makes home-mode prompts point at `~/.pickforge/projects/<id>/context/...`
  (the only correct paths there) and project-local prompts absolute too.
- `AgentLauncher` is built in `AgentLauncherModule.agentLauncher(...)` — add the
  service param there. Update `test/core/agent/agent_launcher_test.dart` and any
  prompt-rendering test to the new absolute output.
- Optional clarity: rename `pickforgeDirRelative`→`pickforgeContextDir` in
  `PromptTemplateVariables` (placeholder key `{{pickforge_dir}}` stays the same so
  templates don't change). Keep the diff tight.

## Part C — MCP IPC discovery precedence

`lib/core/mcp/pickforge_mcp_server.dart` `_readEndpoint` (now uses
`resolved.ipcSockPath`). Add precedence, reading the process environment (inject an
optional `Map<String,String> environment` into the server ctor, default
`Platform.environment`, for testability):
1. if `PICKFORGE_IPC_ENDPOINT` set & non-empty → return it directly (already the socket).
2. else if `PICKFORGE_CONTEXT_DIR` set → read `<that>/ipc.sock-path`.
3. else → fallback to `(await _storage.resolve(_projectRoot)).ipcSockPath` (current).
Add tests in `test/core/mcp/pickforge_mcp_server_test.dart` for each precedence tier.
Update `docs/architecture/pickforge-mcp.md` discovery section (brief).

## Part D — skill_store + attachment_policy home-mode (1B follow-ups)

- Add getters to `lib/core/storage/resolved_context_directory.dart`:
  `skillsDir` and `promptTemplatesDir`. project-local: `p.join(contextDir, 'skills')`
  / `p.join(contextDir, 'prompt-templates')` (== `.pickforge/skills` etc, parity).
  home/custom: siblings of context/runs/chats under the per-project base (use the
  same `p.dirname(runsDir)` base as `pastesDir`).
- `lib/core/skills/skill_store.dart`: inject `ContextStorageService` (it is
  `@singleton` via `SkillsModule`); replace the literal `$projectRoot/.pickforge/skills/<id>.md`
  (~line 51) and `$projectRoot/.pickforge/prompt-templates` (~line 87) with
  `resolved.skillsDir` / `resolved.promptTemplatesDir`. Add parity + home tests.
- `lib/core/agent/context_attachment_policy.dart:53`: the `.startsWith('.pickforge/')`
  guard — make it home-mode aware (also treat a path under the resolved contextDir as
  internal). Keep project-local behavior. Minimal change; add a test.

## Verification (run, fix until green, report exact results)

1. `fvm dart run build_runner build --delete-conflicting-outputs`
2. `fvm dart format .`
3. `fvm flutter analyze` (0 issues)
4. Targeted: `fvm flutter test test/core/agent/ test/core/mcp/ test/core/skills/ test/core/storage/ test/core/terminal/ test/features/workbench/`
5. Full: `fvm flutter test` (all green incl. goldens)

STOP and report if injecting env at the PTY create site requires a refactor larger
than described, or if the absolute-path prompt change cascades into golden/UI tests
that assert specific prompt text in a way that needs design input.
