# Option A — Rust core, keep the Flutter UI

Drafted 2026-06-17. Status: **exploratory, not scheduled.** Read
[`README.md`](README.md) first for the shared core boundary and the A-vs-B fork.

## Verdict

The pragmatic path. Move the OS-heavy + pure-logic layer into a Rust core behind
`flutter_rust_bridge` (FRB); keep every widget, cubit, token, and golden test.
Fixes the terminal/PTY pain at the root, keeps the mobile capability we already
have, and the core you build is reusable verbatim if we ever go Option B.

**Choose this if:** the goal is to kill the terminal/OS bugs and get a memory-safe,
fast data path without betting the design system or the mobile story. (It does
**not** shrink the app's footprint — see Risks.)

## Architecture

```
        Flutter UI (unchanged)                 Rust core crate (new)
 ┌──────────────────────────────┐      ┌──────────────────────────────────┐
 │ features/*/view + cubit      │      │ pty (portable-pty)               │
 │ shared/components (tokens)    │ FRB  │ process runner + binary detect    │
 │ xterm.dart render widget     │◀────▶│ adb / cdp / target adapters       │
 │ window_manager, clipboard     │ 2.12 │ vm_service JSON-RPC + decode      │
 │ BLoC translates core ↔ widget │      │ transcript record/replay          │
 └──────────────────────────────┘      │ context dirs + sqlite (rusqlite)  │
   Dart isolate (UI thread)            │ git probe, shell env, agent prep  │
                                       └──────────────────────────────────┘
                                         tokio + thread pool (off-isolate)
```

FRB 2.12 (Flutter Favorite, current as of 2026-03) generates type-safe Dart
bindings from plain Rust in an `api/` folder. Rust work runs off the UI isolate
on FRB's thread pool / tokio runtime and marshals back via `allo-isolate`. Build
integration is **Cargokit** — `cargo build` is wired into each platform's native
build (CMake / Xcode / Gradle), so `fvm flutter build` compiles the Rust lib too.

## The terminal data path (the core win)

This is what we're really buying. Today: `flutter_pty` forks the PTY in Dart and
hands bytes to `xterm`. New:

```
Rust: portable-pty 0.9 spawns $SHELL ──▶ reads master fd on a tokio task
        │                                         │
        │  pty_write / pty_resize (Dart→Rust)     ▼
        │                              StreamSink<Vec<u8>>  (ZeroCopyBuffer)
        ▼                                         │
xterm.dart  ◀──────── Stream<Uint8List> ──────────┘
            Terminal.write(bytes)
```

- `portable-pty` (WezTerm) covers Linux/macOS/Windows (ConPTY, with the
  Win11 22H2 quirk flags). Battle-tested; replaces the buggy `flutter_pty` seam.
- Stream raw bytes via a long-lived `StreamSink<Vec<u8>>` held for the chat's
  lifetime; `ZeroCopyBuffer` avoids copying PTY output across the boundary.
- **Backpressure is DIY** — FRB does not bound the sink. Feed it from a bounded
  `tokio::mpsc` and coalesce bytes into chunks. Load-test heavy output (e.g.
  `yes`, a noisy build) before declaring parity.
- `xterm.dart` stays as the renderer — no UI rewrite. The ANSI/SGR span parser
  (`ansi.dart`) and transcript record/replay move into Rust and feed both the
  renderer and the on-disk `transcript.log` / `.spans.bin`.

## Tech-stack decisions

| Concern | Decision | Notes |
|---|---|---|
| Bridge | `flutter_rust_bridge` 2.12 | Flutter Favorite; `async fn` + `StreamSink` are first-class in v2 |
| Async runtime | `tokio` (FRB's `rust-async` feature) | off-isolate; one shared executor |
| PTY | `portable-pty` 0.9 | desktop only; mobile = remote-PTY companion later |
| Terminal grid state | keep in `xterm.dart` | `alacritty_terminal` only if we need server-side grid; not now |
| SQLite | `rusqlite` + `bundled` feature | pins SQLite, no system dep, identical across platforms |
| Migrations | `rusqlite_migration` (or `refinery`) | **one owner** — see Drift cut-over below |
| Serialization | `serde` | replaces freezed/json_serializable across the boundary |
| Errors | typed enums across FRB, not bare `anyhow` | keeps rich error info on the Dart side |
| Build glue | Cargokit (auto-wired) | adds Rust toolchain + target triples + Android NDK to CI |

### Drift → rusqlite cut-over

Drift is just SQLite on disk; Rust can open the same file. The risk is **two
migration ladders fighting over `PRAGMA user_version`**. Plan:

1. Rust core opens the existing DB file by path, enables **WAL + busy-timeout**.
2. **Rust becomes the single migration owner**; Drift drops to read-only or is
   retired in the same phase it's replaced. No dual-writers.
3. Port the 6 table/DAO groups (Projects, Chats, PickHistory, AgentRunLog,
   RunSessionLog, ProjectSettings) — schema is at v10, no raw SQL outside
   migrations, so this is mechanical.

## Phasing

| Phase | Scope | Exit |
|---|---|---|
| 0 — Scaffold | Add Rust crate, FRB codegen, Cargokit; build green on all 3 desktop OSes | `fvm flutter build` ships the lib; a trivial `ping()` round-trips |
| 1 — Terminal | PTY + process runner + shell env + transcript in Rust; xterm.dart on the new stream | terminal parity incl. backspace/ctrl-c/paste/resize; heavy-output load test passes |
| 2 — Bridges | ADB/CDP, target adapters, source-map/UIAutomator parsers, VM Service client + inspector decode | emulator mirror + widget picker + adapters run off the core; adapter fixture tests pass in Rust |
| 3 — Storage | Drift → rusqlite cut-over | DB owned by Rust; existing data migrates in place |

Each phase keeps the app shippable — the UI calls the core where it's ready and
the old Dart path elsewhere, swapped module by module.

## Risks & sharp edges

- **No Rust hot reload.** Changing Rust needs codegen + a full app restart
  (`r`/`R` won't pick it up). The biggest day-to-day DX hit — wire codegen into a
  pre-commit/CI check so bindings never drift.
- **Heavier builds/CI.** Every dev + CI machine needs the Rust toolchain, all
  target triples, NDK (Android), Xcode tooling (iOS). First builds are slow.
- **iOS** statically links + codesigns the lib via Xcode — standard but untested
  against our provisioning. **Android** needs `cargo-ndk` + `ANDROID_NDK_HOME`.
- **Footprint doesn't shrink.** This moves the hot path to Rust (real CPU/safety
  wins, one shared core, zero-copy bytes) but the Flutter runtime stays. If
  small-binary/low-memory is a hard requirement, that's Option B.
- **Stream backpressure** is on us (see terminal data path). Treat as a tested
  concern, not a freebie.

Precedents: **RustDesk** (desktop+mobile Flutter UI + large Rust core) and the
**rhttp** package both ship Flutter + Rust via FRB. (AppFlowy is Flutter+Rust but
uses a hand-rolled protobuf FFI, *not* FRB — cite it for "the architecture scales,"
not for FRB.)

## Effort

**M–L.** The Rust core is the bulk of the work; the Flutter UI is largely
untouched (cubits re-point from Dart services to FRB calls). Lower risk than B
because the design system, 213 tests, 13 goldens, and the mobile build all stay.

## Where to read code (what each core module replaces)

| Core module | Replaces |
|---|---|
| `pty` | `lib/core/terminal/pty_process.dart`, `flutter_pty_adapter.dart`, `pty_session*.dart`, `shell_invocation.dart` |
| `transcript` | `lib/core/terminal/transcript_recorder.dart`, `transcript_replayer.dart`, `ansi.dart` |
| `process` | `lib/core/process/binary_detector.dart`, process-spawn call sites |
| `devices` | `lib/core/android/android_adb_service.dart`, `lib/core/cdp/cdp_discovery.dart` |
| `targets` | `lib/core/targets/**` (all 6 adapters + parsers) |
| `vmservice` | `lib/core/vm_service/**`, `lib/core/inspector/**` |
| `storage` | `lib/core/drift/**`, `lib/core/storage/context_storage_service.dart` |
| `agent` | `lib/core/agent/agent_launcher.dart`, `pickforge_context_writer.dart`, `agent_model_settings.dart` |
