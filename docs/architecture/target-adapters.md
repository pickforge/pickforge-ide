# Target adapters

PickForge is a Flutter-only widget picker that is growing into a multi-framework
agent workbench. The seam that makes that possible is the **target adapter**: a
capability-based description of one runnable app family (Flutter, React Native,
native Android, native iOS, web) plus the detection and tooling that backs it.

Adapters live in `lib/core/targets/`. The roadmap is
`plans/001-multi-framework-agent-suite-roadmap.md`.

## Vocabulary

- **Project** — a user-selected repository root.
- **Target** — a runnable app target inside a project (e.g. Flutter Android).
- **Adapter** — detects, runs, inspects, and builds context for one target
  family.
- **Capability** — one supported operation (launch, screenshot, logs, inspect
  selection, source mapping, hot reload, MCP tools).
- **Selection** — the UI element/widget/component/node the user picked.

## Capability model

An adapter only declares the capabilities it actually implements
(`TargetCapability`, `lib/core/targets/target_capability.dart`). The workbench
reads those to gate what it offers, so the UI never promises depth an adapter
doesn't have. `TargetWorkflowPolicy` maps a capability set to a **support
level** and the agent workflows + prompt certainty tier it earns.

| Support level | Meaning |
| --- | --- |
| **Deep** | Exact selection→source mapping (Flutter). |
| **Useful** | Run/log/screenshot/inspect + best-effort source hints. |
| **Experimental** | Detection + some tooling; thin runtime. |
| **Manual-only** | Generic fallback: terminal, attachments, prompts. |

The workbench surfaces this with `TargetCapabilityBadges` (lit vs muted per
operation) and `TargetSupportBadge`, reviewed in
`test/goldens/baselines/target_panels.png`.

## Adapters and current status

Detection, command building, and log/hierarchy parsing are **fixture-tested** —
no device, emulator, or browser is required to run the suite. Anything that
needs a live runtime (attaching to a process, capturing a real screen, a CDP
session) is marked **live-pending** and is gated behind the manual smokes in the
roadmap.

| Adapter | Priority | Detects | Fixture-tested | Live-pending |
| --- | --- | --- | --- | --- |
| Flutter | 100 | `pubspec.yaml` + Flutter deps | selection→source mapping, MCP aliases | — (already the live reference flow) |
| React Native (Android) | 80 | `react-native` dep + `android/` | Metro/ADB commands, logcat + UIAutomator parsing, selection context, Metro CDP discovery | Fast Refresh trigger, component tree, device smoke |
| Native Android | 60 | Gradle settings + app plugin | Gradle/ADB commands, UIAutomator parsing, best-effort source hints | device smoke |
| Native iOS | 55 | `.xcworkspace`/`.xcodeproj`/app `Package.swift` | `xcodebuild`/`simctl` commands, simctl device-list parsing (macOS-gated caps) | accessibility hierarchy (needs macOS + a product decision) |
| Web | 50 | `package.json` dev/start scripts | dev-server command, CDP discovery, accessibility-tree + source-map parsing, source-candidate search | DOM/console/network capture, screenshots (live CDP session) |
| Generic | 0 | fallback for any folder | detect only | adapter-mediated terminal/attachments (app-global today) |

Source context never claims more than the evidence allows: only Flutter declares
`mapSelectionToSource`. Every other adapter ships a confidence-ranked
**source-candidate finder** (text/resource-id/testid search) plus a `SourceMap`
v3 resolver for the web, and renders a clear disclaimer when exact mapping isn't
available.

## Shared layers

Where two adapters need the same primitive, it's extracted once and the original
adapter re-exports it via type-alias shims, so the existing test suite stays the
parity check:

- `lib/core/android/` — ADB service, UIAutomator node/parser, UI inspector,
  logcat parser (Native Android + React Native).
- `lib/core/cdp/` — generic CDP discovery (web + React Native Metro).

## Adding an adapter

1. Add a `*ProjectDetector` and a `const *TargetAdapter` under
   `lib/core/targets/<family>/`; register it in the `get_it`/`injectable`
   targets module with a priority below the more specific families.
2. Declare only the capabilities you can back with tested tooling.
3. Add command builders and log/hierarchy parsers as pure, fixture-tested units
   — no live device in the test path.
4. Build selection context through a source-candidate finder; never declare
   `mapSelectionToSource` without direct evidence.
5. Keep process/VM-service/filesystem work in `lib/core/`, never in widgets, and
   never modify the user's project source as part of context preparation.
