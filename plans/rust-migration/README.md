# Rust migration — decision framing

Drafted 2026-06-17. Status: **exploratory, not scheduled.** Two specs sit beside
this README; both are Rust-core architectures. Read this first to pick a lane.

## Why we're looking

Drivers, in priority order:

1. **Terminal / OS-integration pain.** The PTY + process layer (`xterm` +
   `flutter_pty`) keeps generating low-level input/focus/signal bugs. This is
   the 10% of the app where Flutter is actually hurting us.
2. **Performance / footprint.** We want a leaner, faster app and a memory-safe
   hot path for terminal + agent byte streams.

Target reach: **Linux + macOS + Windows desktop now, mobile someday.**

## The one thing both specs share: a Rust core

Both options extract the same OS-heavy + pure-logic layer into a shared Rust
core crate. **Building that core is a no-regret move** — it is ~identical whether
the UI stays Flutter (Option A) or becomes a web frontend (Option B). So the real
fork is *only* the UI layer, and you can defer it.

| Goes into the Rust core | Today's Dart home |
|---|---|
| PTY spawn / read / write / resize / signals | `lib/core/terminal/pty_*.dart`, `shell_invocation.dart` |
| Transcript record / replay + ANSI/SGR span parse | `lib/core/terminal/transcript_*.dart`, `ansi.dart` |
| Process runner + binary detection | `lib/core/process/binary_detector.dart` |
| ADB / CDP / device bridges | `lib/core/android/android_adb_service.dart`, `lib/core/cdp/` |
| Target adapters (flutter / RN / native-android / native-ios / web / generic) | `lib/core/targets/**` |
| Source-map v3 + UIAutomator parsers, source-candidate finders | `lib/core/targets/**` |
| VM Service JSON-RPC client + inspector decode | `lib/core/vm_service/`, `lib/core/inspector/` |
| Context-dir resolution + file I/O | `lib/core/storage/context_storage_service.dart` |
| SQLite (replaces Drift) | `lib/core/drift/**` |
| Shell env resolution, git probe, agent context prep | `lib/core/terminal/`, `lib/core/agent/` |

| Stays in the UI layer (kept for A, rewritten for B) |
|---|
| All `lib/features/*/view/` screens and `lib/features/*/cubit/` state |
| Design system: `lib/shared/components/` (12), tokens, typography, motion |
| Window management, clipboard, golden tests |

> **Mobile reality, stack-independent:** an embedded PTY needs `forkpty` +
> arbitrary process spawn, which iOS/Android sandboxes don't give you. In *both*
> options the local terminal is **desktop-only**; a mobile terminal would be a
> remote-PTY-over-socket companion experience. Mobile is about the *non-terminal*
> features (widget context, history, settings, viewers).

## The two options

| | Option A — Rust core, keep Flutter UI | Option B — Tauri hybrid (Rust core + web UI) |
|---|---|---|
| Spec | [`option-a-rust-core-flutter-ui.md`](option-a-rust-core-flutter-ui.md) | [`option-b-tauri-hybrid.md`](option-b-tauri-hybrid.md) |
| Bridge | `flutter_rust_bridge` 2.12 (FFI, in-process) | Tauri v2 IPC (commands + channels) |
| UI layer | **Unchanged** Flutter widgets | **Full rewrite** in web (SolidJS/Svelte + xterm.js) |
| Design system / 213 tests / 13 goldens | **Kept** | **Rebuilt** (tokens → CSS; Storybook/Playwright) |
| Footprint | ~unchanged (~25MB / ~90MB RAM) | **Big win** (~7–10MB / ~30–45MB RAM) |
| Terminal data path | Rust PTY → `StreamSink<Vec<u8>>` → xterm.dart | Rust PTY → IPC channel → xterm.js (WebGL) |
| Mobile someday | **Strong** — Flutter mobile is free, FRB runs on mobile | **Weak/risky** — Tauri mobile is early-production |
| Linux rendering | Flutter (pixel-identical everywhere) | **WebKitGTK risk** — maintainer-acknowledged instability |
| Effort | **M–L** (core only; UI untouched) | **XL** (~2× A: same core **+** full UI rewrite) |
| Risk | Low | High (Linux webview + mobile + rewrite) |

## Recommendation

**Start with Option A.** It attacks the actual pain (terminal/OS layer) at the
lowest risk, keeps the design system + tests + mobile capability you already
have, and *builds the shared core anyway*. The footprint win is the only thing it
leaves on the table.

**Option B is a UI swap you can decide later** — only worth it if small-binary /
low-memory footprint becomes a hard product requirement, and only if you accept
the Linux WebKitGTK rendering risk and a from-scratch UI + mobile rewrite. Because
the Rust core is shared, doing A first does not waste work if you later go B.

Pick the lane in the per-spec verdicts; each ends with an honest "choose this if…".
