# Target adapters

PickForge supports Flutter, React Native, native Android, native iOS, web, and a
generic project fallback. The adapter seam is the capability-based projection
that keeps framework detection, launch behavior, device policy, inspector depth,
and support claims together.

The current architecture is Rust core → Tauri IPC adapter → SolidJS client:

```text
crates/pickforge-core/src/targets/adapters.rs
                    │
                    ▼
src-tauri/src/device_commands.rs
                    │
                    ▼
src/lib/device.ts + src/lib/runTargets.ts
                    │
                    ▼
src/stores/runTargets.ts → src/stores/runLaunch.ts → src/stores/runConsole.ts
```

The roadmap remains `plans/001-multi-framework-agent-suite-roadmap.md`.

## Vocabulary

- **Project** — a user-selected repository root and, optionally, one bound remote
  host/root.
- **Target** — one runnable app target inside a Project, including detected
  targets and supported `.vscode/launch.json` entries.
- **Adapter** — framework-specific detection and the run/device/inspector policy
  projected into a `RunTarget` and `RunProfile`.
- **Capability** — one earned operation such as launch, screenshot, logs,
  selection inspection, exact source mapping, or MCP tools.
- **Selection** — the UI element, widget, component, or accessibility node the
  user picked.

## Capability and support model

`Capability` and `TargetDetection` live in
`crates/pickforge-core/src/targets/adapters.rs`. The Tauri adapter serializes
those values to the frontend, where `src/lib/runTargets.ts` combines them with a
`RunProfile`: device convention, inspector kind, and log source. Callers gate
behavior through that projection instead of re-detecting a framework from a
command string.

`src/lib/runTargets.ts` maps the declared capabilities to the support tier shown
by the workbench:

| Support tier | Earned behavior |
| --- | --- |
| **Deep** | Launch + inspect + exact selection-to-source mapping. |
| **Useful** | Launch + inspect, without an exact source claim. |
| **Experimental** | Some live tooling, but not the useful/deep combination. |
| **Manual** | Detection and shell-driven work only. |

MCP uses the same capability vector. The protocol and tool gates live in
`crates/pickforge-core/src/mcp/`, the local socket adapter lives in
`src-tauri/src/mcp_commands.rs`, and `src/stores/mcp.ts` publishes the active
`RunTarget`. See `docs/architecture/pickforge-mcp.md`.

## Current adapters

The core detector chooses the highest-priority match and always falls back to
`generic`. Detection is fixture-testable without a live device.

| Adapter | Priority | Detection | Declared depth |
| --- | ---: | --- | --- |
| Flutter | 100 | `pubspec.yaml` declaring the Flutter SDK | launch/stop, reload/restart, screenshot, logs, VM Service selection, exact source mapping, MCP tools |
| React Native (Android) | 80 | `react-native` dependency plus `android/` | launch/stop, screenshot, logs, UIAutomator selection |
| Native Android | 60 | Gradle settings plus a root build file | launch, screenshot, logs, UIAutomator selection |
| Native iOS | 55 | Xcode container or iOS `Package.swift` | launch, screenshot, logs, accessibility selection |
| Web | 40 | `package.json` plus a recognized web entry/config | screenshot, CDP selection, source mapping |
| Generic | 0 | fallback | detection only |

Framework-specific primitives remain in deep core modules:

- Android and React Native share `crates/pickforge-core/src/android/`.
- Native iOS uses `crates/pickforge-core/src/ios/`.
- Web inspection uses `crates/pickforge-core/src/cdp.rs` and source maps use
  `crates/pickforge-core/src/targets/source_map.rs`.
- Flutter inspection remains protocol-specific in
  `crates/pickforge-core/src/vm_service.rs`.
- CDP and VM Service share only generation-safe WebSocket ownership,
  correlation, timeout cleanup, and loopback admission through
  `crates/pickforge-core/src/correlated_ws.rs`; their result and event behavior
  stays in each protocol adapter.

## One captured execution transaction

A launch captures its Project, target, saved device selection, and remote binding
synchronously before awaited discovery or boot work in
`src/stores/runLaunch.ts`. `src/stores/runConsole.ts` receives those captured
facts for PTY launch and history instead of reading the currently active Project
again.

`src/lib/remoteContext.ts` is the frontend routing authority:

- `resolvePtyRemote` makes an explicitly captured local/remote decision win over
  a later workspace lookup.
- `executionRemoteFor` keeps a nested target cwd on the captured remote host.
- `remotePathFor` maps an approved local Project path into its bound remote root.

Remote discovery is performed through `src/lib/remoteHost.ts`; it does not read
local target/device state as a fallback. The Tauri PTY boundary re-authorizes the
stored Project/host/root binding in `src-tauri/src/pty_commands.rs`. A remote
Project's host and root remain authoritative, and its local mirror is excluded
from filesystem authority by `src-tauri/src/project_roots.rs`. The broader
transport and credential rules are in `docs/architecture/remote-host-mode.md`.

## Adding or deepening an adapter

1. Add detection and the honest `Capability` set in
   `crates/pickforge-core/src/targets/adapters.rs`.
2. Add framework primitives to the appropriate deep core module; keep Tauri in
   `src-tauri/src/` as an IPC adapter rather than a second implementation.
3. Add or update the single `RunProfile` mapping in `src/lib/runTargets.ts` so
   device, inspector, and log policy travel with the target.
4. Route discovery through `src/lib/runTargets.ts` and launch through the
   captured transaction in `src/stores/runLaunch.ts`; do not read mutable active
   Project facts after an await.
5. Declare exact source mapping or MCP exposure only when the implementation and
   focused tests earn those capabilities.
6. Preserve remote authority: a failure on a bound remote Project is an error,
   never permission to run local discovery, device work, PTYs, or file access.
