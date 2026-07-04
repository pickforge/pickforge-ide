# Agent IDE — build status

PickForge's evolution from a Flutter-only widget picker into an **agent IDE for mobile
developers** across Flutter, React Native (Android), native Android, and web. Epic: **#7**.

## Done (merged to `main`)

**Reported bugs** — #8 view-only debug console + Clear · #9 run stop-mid-startup (SIGINT) ·
#10 mirror stats reflow · #11 terminal-selection "Ask AI".

**Multi-framework core** — #14/#15/#16 run-control contract + per-adapter device injection ·
#17 UIAutomator inspector · #18 forge a selected element to the agent (non-Flutter) ·
#19 per-kind inspector copy · #20 logcat panel · #21 run/forge persistence ·
#22 honest support-tier badge · #39 web CDP inspector + source-map select-to-source.

**Agent loop** — #38 local capability-gated MCP endpoint (selection / screenshot / logs /
context) over a unix socket, discovered via `PICKFORGE_IPC_ENDPOINT`.

**Security + robustness** — #26 inspect_save sanitize · #27 fs commands constrained to
approved roots + bounded reads (+ hardening: registration only via a server-side native
pick) · #28 PTY/mirror IPC authorization + payload bounds · #29 Drift-safe DB migrations ·
#30 core robustness (bounded runner, VM/PTY teardown) · #25 cancel a hung emulator boot.

**Quality infra** — #31 CI gate (cargo + tsc/build; VRT non-blocking) · #32 unit tests ·
#33 opt-in live-device E2E harness · #34–#37 per-adapter live smokes · #40 README +
onboarding reposition.

## Support tiers (honest — surfaced in-app + README)

| Framework | Tier | What works |
|---|---|---|
| Flutter | **Deep** | run / hot reload+restart, VM-service widget inspector with exact selection→source, screenshots, forge |
| React Native (Android) | **Useful** | device run, UIAutomator inspector + screenshot, logcat, forge with best-effort source hints |
| Native Android | **Useful** | Gradle run, UIAutomator inspector + logcat + forge with best-effort hints |
| Web | **Experimental** | dev-server run, CDP DOM inspection + partial source maps |
| iOS | **Experimental** | live `xcodebuild` run + `simctl` screenshot + `os_log` stream (proven on a real simulator); no element inspector yet — Flutter-on-iOS still gets the Deep VM-service inspector |

## Live validation

The device layer (screencap → PNG, UIAutomator → accessibility tree, logcat → parsed) is
proven on a real Android emulator, and the Flutter smoke runs end-to-end on-device
(launch → foreground → screenshot → UIAutomator dump → clean teardown). The harness
(#33) + per-adapter smokes (#34–#37) gate cleanly on `PICKFORGE_E2E_SERIAL` /
`PICKFORGE_E2E_LAUNCH` so normal `cargo test` and CI never need a device. See
`tests/e2e/README.md`.

The native-iOS device layer (`simctl` screenshot → PNG, `os_log` → parsed events) is
likewise proven on a real iOS simulator (Xcode 26.6 / iOS 26.5): Tier A captured a
2.8 MB screenshot and parsed 4303 `os_log` events, and Tier B built
`fixtures/sample_ios_app` → installed → launched → screenshot → terminate. Gated on
`PICKFORGE_E2E_IOS_UDID` (+ `PICKFORGE_E2E_LAUNCH=1` for the build/launch tier).

## Remaining

**iOS element inspector** — the native-iOS adapter now ships live `xcodebuild` launch,
`simctl` screenshot, and `os_log` streaming (validated on-device). The remaining piece is
element-tree inspection (an XCUITest/idb accessibility bridge), tracked in epic #7.
Everything else is merged.

## Process

Each substantial change went through the Codex + Opus delegation workflow: a Codex
correctness/backend review and (for UI) an Opus design review before merge, then the
GitHub Codex pass on PR open, fixing valid findings. Conventional Commits, no AI
attribution.
