# Embedded terminal

The embedded terminal (xterm + flutter_pty) renders agent CLIs (Claude Code,
Codex, OpenCode, …). Getting Claude and Codex to render **with correct colors
and no stray underlines** is a first-class requirement.

## Files

| File | Role |
| ---- | ---- |
| `lib/core/terminal/terminal_themes.dart` | The 16-color ANSI palettes (incl. brand `pickforgeEmber`). |
| `lib/core/terminal/live_terminal_output.dart` | ANSI/SGR normalization + underline stripping at write time. |
| `lib/core/terminal/pty_environment.dart` | Forces color env for spawned agents. |
| `lib/core/terminal/embedded_terminal_settings.dart` | Font/size/theme prefs + defaults. |
| `lib/features/workbench/view/chat_workbench_panel.dart` | The `TerminalView` host (`_ChatTerminal`). |

## Brand defaults

`EmbeddedTerminalSettings.defaults` → font **`GeistMono`**, size 14, theme
**`pickforgeEmber`**. `_ChatTerminal` loads the user's *saved* settings (so the
Settings → Embedded Terminal controls actually apply) and falls back through a
Nerd-Font chain (`JetBrainsMono Nerd Font`, …) for box-drawing / powerline
glyphs Geist Mono may lack.

The `pickforgeEmber` theme puts agent output on the brand canvas: background
`#0A0A0B`, foreground `#F2F2F3`, **ember cursor**, and an ANSI palette mapped to
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

The model each agent runs under is wired separately — see
`lib/core/agent/agent_model_settings.dart` (defaults: Claude → `claude-haiku-4-5`,
Codex → `gpt-5.3-codex-spark`) and the Settings → "Agent models" picker. The
flag is appended in each profile's `ptyArgsFor(model: …)`.
