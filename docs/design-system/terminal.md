# Embedded terminal

The embedded terminal (xterm + flutter_pty) is **shell-first**: opening a chat
spawns the user's `$SHELL` (zsh/bash, interactive, cwd = project root), never
an agent CLI. Agents are launched by the user — the quick-launch chips above
the terminal type a ready-made command (e.g. `claude --model claude-haiku-4-5`)
at the prompt without running it. Rendering agent TUIs (Claude Code, Codex,
OpenCode, …) **with correct colors and no stray underlines** remains a
first-class requirement.

## Files

| File | Role |
| ---- | ---- |
| `lib/core/terminal/shell_invocation.dart` | Resolves `$SHELL` (fallback zsh → bash → sh; `-l` on macOS). |
| `lib/core/terminal/terminal_themes.dart` | The 16-color ANSI palettes (incl. brand `pickforgeEmber`). |
| `lib/core/terminal/live_terminal_output.dart` | ANSI/SGR normalization, underline stripping, post-replay mode reset. |
| `lib/core/terminal/pty_environment.dart` | Forces color env for the spawned shell and everything it runs. |
| `lib/core/terminal/embedded_terminal_settings.dart` | Font/size/theme prefs + defaults. |
| `lib/core/terminal/terminal_paste_controller.dart` | Smart paste: clipboard image → file path, text → bracketed paste. |
| `lib/core/terminal/pasted_image_store.dart` | Saves pasted images under `.pickforge/pastes/` (7-day retention). |
| `lib/features/workbench/view/agent_launch_chips.dart` | Quick-launch chip strip (availability, ember emphasis). |
| `lib/features/workbench/view/terminal_pane_host.dart` | Pane tree host + per-pane `TerminalView` (`TerminalPane`). |

## Multi-pane splits

Each chat's terminal area is a splittable tree of shell panes
(`lib/features/workbench/cubit/terminal_panes_cubit.dart` +
`lib/features/workbench/view/terminal_pane_host.dart`). Every pane is its own
PTY (pool key `chatId` for the first pane, `chatId--<paneId>` for the rest)
with a header showing a short callsign (Mae, Gus, Ivy, …) and the project's
current git branch (`lib/core/git/git_branch_probe.dart`, 5s poll, flags
linked worktrees). Header controls: split left/right/up/down, fullscreen
toggle, close; drag a header onto another pane's edge to dock it there. The
layout lives in an in-memory `TerminalPaneLayoutStore` for the app session.
Quick-launch chips and "Forge it" pastes address the focused pane.

## Paste, copy, and "Forge it"

- **Nothing PickForge sends auto-executes.** "Forge it" *pastes* the prepared
  prompt (`PtySessionPool.paste`); quick-launch chips *type* their command
  (`PtySession.typeText`). The user presses Enter.
- Pastes are **bracketed** (`ESC[200~ … 201~`). The live terminal registers
  `Terminal.paste` as the pool's paste delegate, which brackets only when the
  foreground app enabled mode 2004 (zsh, bash ≥ 5.1, and agent TUIs all do).
- **Ctrl+Shift+V** (or Cmd+V on macOS) smart-pastes: a clipboard image is
  saved to `.pickforge/pastes/` and its relative path typed; text is pasted.
  **Ctrl+Shift+C** copies the selection; right-click opens Copy/Paste. xterm's
  default shortcuts are disabled (`shortcuts: const {}`) so plain Ctrl+V /
  Ctrl+A reach the shell and TUIs.
- After scrollback replay, `resetReplayedTerminalModes` clears modes a dead
  session left enabled (mouse reporting, alt screen, bracketed paste, hidden
  cursor) so the fresh shell isn't haunted by them.

## Brand defaults

`EmbeddedTerminalSettings.defaults` → font **`GeistMono`**, size 14, theme
**`pickforgeEmber`**. Each `TerminalPane` loads the user's *saved* settings (so the
Settings → Embedded Terminal controls actually apply) and falls back through a
Nerd-Font chain (`JetBrainsMono Nerd Font`, …) for box-drawing / powerline
glyphs Geist Mono may lack.

The `pickforgeEmber` theme puts agent output on the brand canvas: background
`#151110` (the warm brand surface), foreground `#F2F2F3`, **ember cursor**, and an ANSI palette mapped to
the brand semantic colors (red=error, green=connected, yellow=warning,
blue=info) so Claude/Codex stay vivid and legible.

## Color env (so agents emit color)

`normalizePtyEnvironment` removes `NO_COLOR`/`ANSI_COLORS_DISABLED` and sets
`TERM=xterm-256color`, `COLORTERM=truecolor`, `CLICOLOR=1`.

## Underline / SGR handling

Agents sometimes emit underline (`SGR 4`) and underline-color codes (`58/59`)
that render as stray underlines in xterm. `writeLiveTerminalOutput`:

- Normalizes the SGR stream (`normalizeLiveTerminalOutput`): rewrites `4`→`24`
  (no underline), drops `58/59`, and normalizes extended-color forms
  (`38/48;5;n` and `38/48;2;r;g;b`).
- Then sweeps both buffers to clear any residual underline cell attribute.

> **If you touch this:** keep the stream normalization as the source of truth.
> The regression guard is the golden `test/goldens/terminal_render_golden_test.dart`
> → `test/goldens/baselines/terminal_render.png`, which feeds real Claude/Codex
> escape sequences (256-color, truecolor, bold, an underlined line, semantic
> colors) and verifies colors render while the underlined line shows none.

## Agent models

The model each quick-launch chip pins is wired separately — see
`lib/core/agent/agent_model_settings.dart` (defaults: Claude → `claude-haiku-4-5`,
Codex → `gpt-5.3-codex-spark`) and the Settings → "Agent models" picker. The
flag is appended in each profile's `launchCommand(model: …)`, which is what the
chip types at the prompt. The Settings → "Preferred agent" dropdown decides
which chip is emphasized (the pane's single ember accent) and sorted first.
