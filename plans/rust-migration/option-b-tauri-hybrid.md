# Option B — Tauri hybrid (Rust core + web UI)

Drafted 2026-06-17. Status: **exploratory, not scheduled.** Read
[`README.md`](README.md) first for the shared core boundary and the A-vs-B fork.

## Verdict

The footprint play. Same Rust core as Option A, but the UI is rewritten in web
tech inside a Tauri v2 shell. Wins decisively on binary size / memory / startup;
pays for it with a from-scratch UI, the Linux WebKitGTK rendering risk, and a
weaker mobile story.

**Choose this if:** a small/fast/low-memory binary is a hard product requirement
and you accept (a) rebuilding the entire UI + test suite in web, (b) WebKitGTK
rendering instability on Linux — the platform you develop and ship on, and (c)
mobile being early-production rather than free.

## Architecture

```
        Web UI (full rewrite)                  Rust core (same as Option A)
 ┌──────────────────────────────┐      ┌──────────────────────────────────┐
 │ SolidJS / Svelte 5 + Vite     │ Tauri│ pty (portable-pty)               │
 │ tokens → CSS custom props     │ v2   │ process runner + binary detect    │
 │ xterm.js (WebGL renderer)     │ IPC  │ adb / cdp / target adapters       │
 │ Storybook + Playwright VRT    │◀────▶│ vm_service JSON-RPC + decode      │
 └──────────────────────────────┘ cmds │ transcript record/replay          │
   System webview:                +chan │ context dirs + sqlite (sqlx/rusqlite)│
   WebView2 / WKWebView / WebKitGTK     │ git probe, shell env, agent prep  │
                                       └──────────────────────────────────┘
```

Tauri v2 (2.11.x, stable since 2024-10) runs the Rust core **in-process** as the
backend; the UI is a webview. Three IPC primitives: **commands** (`invoke`,
request/response — your RPC), **events** (fire-and-forget, JSON, *not* for high
throughput), and **channels** (`tauri::ipc::Channel<T>`, ordered + fast — the
right primitive for streaming).

## The Rust core

Identical boundary to Option A (see README table) — PTY, process runner, device
bridges, target adapters, VM Service client, context dirs, SQLite, agent prep.
**This is why doing the core first is a no-regret move:** if you build it for
Option A and later swap the UI, you keep it. The only delta is persistence — under
Tauri you may prefer `sqlx` (async, fits the command/`State<T>` model) over
`rusqlite`; both work.

## UI rewrite — what dies, what carries

**Nothing in the Flutter widget layer survives.** Every `lib/shared/components/`
widget and every `lib/features/*/view/` screen is rebuilt as HTML/CSS + JS.
BLoC/Cubit, GoRouter, GetIt, Drift, and the golden tests are all replaced.

What carries (concepts, not code):

| Carries over | How |
|---|---|
| Design tokens (the ten rules) | Map 1:1 — and more naturally — to **CSS custom properties**; Geist/GeistMono via `@font-face`; one easing via a shared `transition`/`@keyframes`; `@media (prefers-reduced-motion: reduce)` natively honors the ReduceMotion rule |
| Terminal architecture | Shell-first PTY model ports directly to portable-pty + channel + xterm.js |
| Business-logic concepts | agent settings, target adapters, source finders → Rust commands |
| Assets / copy / l10n / IA | reused as-is |

## Web stack decisions

| Concern | Decision | Notes |
|---|---|---|
| Framework | **SolidJS or Svelte 5** | fine-grained reactivity, smallest overhead — best for a streaming terminal UI. React only if ecosystem outweighs the repaint overhead |
| Build | Vite | first-class in `create-tauri-app` templates |
| Terminal | **xterm.js + WebGL renderer** | GPU-accelerated; the proven heavy-output path |
| Tokens | CSS custom properties | direct map from `pickforge_colors/typography/spacing` |
| Visual regression | **Storybook** (component goldens) + **Playwright `toHaveScreenshot`** (full-screen flows) | replaces Flutter goldens; note macOS WebDriver is unsupported |
| DB access | `sqlx` behind Tauri commands | async, fits `State<T>`; or `rusqlite` as in A |
| State | Rust `app.manage(State<T>)` + framework store on the JS side | |

## Terminal & process — the proven pattern

```
Rust: portable-pty spawns $SHELL ──▶ coalesce bytes ──▶ Channel<Vec<u8>>.send()
                                                              │
xterm.js (WebGL) ◀──── channel.onmessage ─────────────────────┘
   term.write(bytes);   input/resize ──▶ invoke('pty_write'/'pty_resize')
```

- Use **channels, not events**, for stdout (events are explicitly not for high
  throughput and can arrive out of order). Coalesce PTY bytes into chunks.
- **Do not use `node-pty`** — it drags Node in and defeats the footprint win.
  `portable-pty` is the native Rust equivalent.
- Reference: **Terax** (`emee-dev/terax-ai-tauri-terminal`) ships this exact stack
  — Tauri 2 + portable-pty + React + xterm.js/WebGL — at a **~7MB** bundle. The
  community `tauri-plugin-pty` exists but is early-stage; build a thin layer
  ourselves rather than depend on it.

### Process spawning + the capabilities cost

External CLIs (agents, `adb`, `xcrun simctl`) go through `@tauri-apps/plugin-shell`
or bundled **sidecars**. Tauri is **default-deny**: every command + its argument
shape must be allow-listed in `src-tauri/capabilities/*.json` with regex arg
validators. This is a security upgrade over Flutter's "just spawn it" but a real
design cost for a tool that shells out to many CLIs with user-driven args. (Agents
run *through* the portable-pty layer, which sidesteps shell-scope rigidity but
moves the responsibility to us.)

## Footprint payoff

Representative 2026 numbers (vary by app):

| Metric | Flutter (today) | **Tauri** | Electron |
|---|---|---|---|
| Bundle | ~25MB | **~7–10MB** | ~80–200MB |
| Idle memory | ~90MB | **~30–45MB** | ~180–300MB |
| Cold start | ~1.8s | **~0.5–1.4s** | ~1.4–3.2s |
| Release build | ~3min | ~4min (Rust compile) | ~2min |

This is the entire reason to pick B over A.

## Risks — read these before committing

- **Linux WebKitGTK is the headline risk.** macOS/iOS use WKWebView, Windows uses
  WebView2 (both solid); Linux uses WebKitGTK, which has documented perf/rendering
  instability (large-DOM slowness, maximize glitches, regressions after 2.40).
  Tauri maintainers themselves won't fully endorse it for Linux-critical teams.
  **We develop on CachyOS and ship Linux** — Geist rendering, motion, and layout
  must be verified per-engine; you lose Flutter's pixel-identical guarantee.
  GTK4/CEF alternatives are in progress but not default.
- **Mobile is early-production.** iOS+Android build from the same core, but with
  plugin gaps, an Android main-thread/ANR hazard for long ops, flaky HMR, and
  weaker DX. This is a regression from Flutter's mobile strength — pilot before
  betting on it. (And the terminal stays desktop-only either way — see README.)
- **Full UI + test rewrite.** ~2× the work of Option A. Only the tokens and
  architecture concepts transfer.
- **Capability scoping** adds ongoing design overhead for every external command.

## Phasing

| Phase | Scope |
|---|---|
| 0 | Tauri scaffold + chosen web framework; tokens → CSS; one screen + xterm.js round-trips through a command |
| 1 | Rust core (PTY, process, transcript, shell env) + terminal pane parity in the webview |
| 2 | Rebuild remaining screens (workbench, forge, widget picker, emulator, settings, history); Storybook/Playwright VRT suite |
| 3 | Device bridges + VM Service + adapters wired through commands; SQLite owned by Rust |
| 4 | Packaging per platform; mobile pilot (separate go/no-go) |

## Packaging

Tauri bundler emits natively: Linux `.AppImage`/`.deb`/`.rpm`, Windows
`.msi`/`.exe` (NSIS), macOS `.app`/`.dmg`, mobile `.aab`/`.apk` / `.ipa`. CI via
the official `tauri-action`.

## Effort

**XL — roughly 2× Option A.** Same Rust core *plus* a complete UI rewrite, a new
test stack, and per-engine rendering verification. Justified only by the footprint
win and only if the Linux + mobile risks are acceptable.
