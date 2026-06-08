<p align="center">
  <img src="assets/branding/pickforge-lockup-horizontal.png" alt="PickForge" height="96">
</p>
<p align="center"><em>Widget-level AI context for Flutter.</em></p>
<p align="center"><a href="https://pickforge.dev">pickforge.dev</a></p>

---

PickForge is a local **Flutter desktop app** that lets you pick a widget in
your running Flutter app and dispatch its full context — source, ancestor
chain, screenshots — to an AI coding CLI (Claude Code, Codex, OpenCode) in a
new terminal. The agent makes a surgical edit; you hot-reload; repeat.

> PickForge is MIT-licensed open source. You bring your own agent credentials.
> Nothing leaves your machine.

## Quick start

1. Launch PickForge. On first run it asks you to **Add your first project** —
   pick the folder of a Flutter project (one that has a `pubspec.yaml`).
2. Inside the workbench, hit **+ New chat** to spawn a persistent agent CLI
   session in the embedded terminal pane. Each chat keeps its own scrollback
   across app restarts.
3. Run your Flutter app and paste its VM Service URL into the inspector pane
   to enable widget picking.
4. Tap a widget in the emulator, then click **Forge it** to dispatch the
   widget context as a prompt into the active chat.

## What it writes to your project

Only a single `.pickforge/` folder at your project root:

```
.pickforge/
  .gitignore           # auto-generated, contains "*"
  skill-active.md      # the current skill directive
  widget-context.md    # the selected widget's details
  screenshot.png       # Flutter render (when available)
  device-screen.png    # full device screen with highlight (Android + adb)
  initial-prompt.md    # what PickForge piped to your agent
  run-log.json         # session metadata
```

PickForge **never** modifies your `CLAUDE.md`, `AGENTS.md`, or any of your own
files. If `.pickforge/` already exists and wasn't created by PickForge, it
refuses to proceed.

Detailed storage, retention, and migration-backup policy lives in
[`docs/architecture/storage.md`](docs/architecture/storage.md).

## Install

Download from [Releases](https://github.com/pickforge/pickforge/releases)
— `.AppImage` (Linux), `.dmg` (macOS), `.msi` (Windows).

Or build from source:

```bash
git clone https://github.com/pickforge/pickforge
cd pickforge
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run -d linux   # or -d macos, -d windows
```

## Supported stack

| Category | Supported |
|---|---|
| Target platforms (for the app under debug) | Android emulator (MVP). iOS Simulator, Flutter web, and Flutter desktop are planned. |
| Agents | Claude Code, Codex, OpenCode. More planned. |
| Terminal | Embedded `xterm` + PTY — no external terminal apps required. Per-chat scrollback persists in `.pickforge/chats/<chatId>/transcript.log`. |

## Branding

Canonical PickForge brand assets live in `assets/branding/`. The set follows the Pickforge Studio v2 system: dark canvas, off-white selection bracket, and one ember accent.

## Contributing

PRs welcome. See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for expectations.

Design spec: `docs/superpowers/specs/2026-04-23-pickforge-design.md`.
Implementation plan: `docs/superpowers/plans/2026-04-23-pickforge-mvp.md`.

## License

[MIT](LICENSE).
