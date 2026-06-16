<p align="center">
  <img src="assets/branding/pickforge-lockup-horizontal.svg" alt="PickForge" width="560">
</p>

# PickForge

Widget-level AI context for Flutter. PickForge is a local desktop app that lets you pick a widget in your running Flutter app and dispatch its full context — source, ancestor chain, screenshots — to an AI coding CLI (Claude Code, Codex, OpenCode) in an embedded terminal. The agent makes a surgical edit; you hot-reload; repeat.

PickForge builds the app. PickLab lets agents see, run, and test it. PickArena measures the results.

Local-first. Open source. Built for people who ship. You bring your own agent credentials — nothing leaves your machine.

## Install

Download from [Releases](https://github.com/pickforge/pickforge/releases) — `.AppImage` (Linux), `.dmg` (macOS), `.msi` (Windows).

Or build from source:

```bash
git clone https://github.com/pickforge/pickforge
cd pickforge
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run -d linux   # or -d macos, -d windows
```

## Quickstart

1. Launch PickForge. On first run it asks you to **Add your first project** — pick the folder of a Flutter project (one that has a `pubspec.yaml`).
2. Inside the workbench, hit **+ New chat** to spawn a persistent agent CLI session in the embedded terminal pane. Each chat keeps its own scrollback across app restarts.
3. Run your Flutter app and paste its VM Service URL into the inspector pane to enable widget picking.
4. Tap a widget in the emulator, then click **Forge it** to dispatch the widget context as a prompt into the active chat.

### The loop

Pick a widget, forge its context to the agent, let it edit, hot-reload, pick the next one. The agent never gets a context dump — it gets exactly the widget you pointed at, with its source location, ancestor chain, and screenshots.

<p align="center">
  <img src="assets/branding/pickforge-workbench-mock.svg" alt="PICKFORGE · WORKBENCH — emulator with picked widget, widget context, agent terminal, and the pick-forge-edit-reload loop" width="900">
</p>

## Where it writes your context

By default PickForge keeps each project's chats, runs, screenshots, and context
files in your **PickForge home** (`~/.pickforge/projects/<projectId>/`), outside
the repo — so a fresh clone has nothing extra to ignore. Per project you can
switch to **project-local** storage (a `.pickforge/` folder in the repo) or a
**custom** folder, under **Settings → Context storage**.

When stored project-local, the layout at your project root is:

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

In home/custom mode the same files live under
`~/.pickforge/projects/<projectId>/` (or your chosen folder) instead — so
transcripts are no longer always under `.pickforge`.

PickForge **never** modifies your `CLAUDE.md`, `AGENTS.md`, or any of your own
files. The repo-write `.pickforge/` marker rule applies to project-local mode
only: if a `.pickforge/` already exists there and wasn't created by PickForge,
it refuses to proceed. Switching storage modes offers to **copy** existing data
to the new location and always leaves the originals in place.

Detailed storage, retention, and migration-backup policy lives in [`docs/architecture/storage.md`](docs/architecture/storage.md).

## Supported stack

| Category | Supported |
| --- | --- |
| Target platforms (for the app under debug) | Android emulator (MVP). iOS Simulator, Flutter web, and Flutter desktop are planned. |
| Agents | Claude Code, Codex, OpenCode. More planned. |
| Terminal | Embedded `xterm` + PTY — no external terminal apps required. Per-chat scrollback persists under the project's resolved context storage (project-local example: `.pickforge/chats/<chatId>/transcript.log`). |

## Branding

Canonical PickForge brand assets live in `assets/branding/`. The set follows the Pickforge Studio v2 system: dark canvas, off-white selection bracket, and one ember accent.

## Contributing

PRs welcome. See [SECURITY.md](SECURITY.md) for vulnerability reporting and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for expectations.

Design spec: `docs/superpowers/specs/2026-04-23-pickforge-design.md`.
Implementation plan: `docs/superpowers/plans/2026-04-23-pickforge-mvp.md`.

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <a href="https://pickforge.dev">
    <img src="assets/branding/pickforge-studio-footer.svg" alt="Pickforge Studio — local-first, open source, built for people who ship" width="560">
  </a>
</p>
