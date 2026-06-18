# PickForge — Tauri hybrid (Option B)

Rust core + SolidJS UI inside a Tauri v2 shell. This is the Option B migration
target (see `../plans/rust-migration/option-b-tauri-hybrid.md`).

## Layout

```
tauri/
  crates/pickforge-core/   UI-agnostic Rust core (PTY today; more per phase)
  src-tauri/               Tauri v2 binary — adapts the core to IPC
  src/                     SolidJS frontend (tokens → CSS, xterm.js terminal)
  public/fonts/            Geist + Geist Mono (OFL)
```

## Develop

```bash
npm install
npm run tauri dev      # builds the Rust shell + serves the Vite frontend
```

## Verify (Phase 0)

```bash
npm run build                       # tsc + vite build → dist/
cargo check                         # whole workspace
cargo test -p pickforge-core        # core unit tests
```

Phase 0 done = the window opens to the app shell, the terminal pane runs a live
`$SHELL`, keystrokes echo, output streams, resize reflows, and the quick-launch
chips type a command into the shell.
