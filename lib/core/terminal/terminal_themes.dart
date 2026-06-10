import 'package:flutter/widgets.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:xterm/xterm.dart';

/// The PickForge brand terminal theme — agent output on the cold canvas.
/// Background/foreground use the brand surface + text; the cursor is ember,
/// and the 16-color ANSI palette maps to the brand semantic colors so Claude
/// and Codex render vividly and legibly while feeling native to PickForge.
const TerminalTheme _pickforgeEmber = TerminalTheme(
  cursor: Color(0xFFFF7A1A), // ember
  selection: Color(0x33FF7A1A), // ember 20%
  foreground: Color(0xFFF2F2F3), // brand text
  background: Color(0xFF151110), // brand surface
  black: Color(0xFF17171A),
  red: Color(0xFFFF6B5C), // brand error
  green: Color(0xFF3DD68C), // brand connected
  yellow: Color(0xFFF2B53A), // brand warning
  blue: Color(0xFF7AA2FF), // brand info
  magenta: Color(0xFFC59CFF),
  cyan: Color(0xFF5BD0D6),
  white: Color(0xFFD8D8DC),
  brightBlack: Color(0xFF6E6E75), // muted
  brightRed: Color(0xFFFF8A7E),
  brightGreen: Color(0xFF6FE3AE),
  brightYellow: Color(0xFFFFD08A),
  brightBlue: Color(0xFF9DB9FF),
  brightMagenta: Color(0xFFD6B8FF),
  brightCyan: Color(0xFF8AE0E6),
  brightWhite: Color(0xFFFFFFFF),
  searchHitBackground: Color(0x66FF7A1A),
  searchHitBackgroundCurrent: Color(0xFFFF7A1A),
  searchHitForeground: Color(0xFF151110),
);

const TerminalTheme _draculaDark = TerminalTheme(
  cursor: Color(0xFFF8F8F2),
  selection: Color(0x55BD93F9),
  foreground: Color(0xFFF8F8F2),
  background: Color(0xFF282A36),
  black: Color(0xFF21222C),
  red: Color(0xFFFF5555),
  green: Color(0xFF50FA7B),
  yellow: Color(0xFFF1FA8C),
  blue: Color(0xFFBD93F9),
  magenta: Color(0xFFFF79C6),
  cyan: Color(0xFF8BE9FD),
  white: Color(0xFFF8F8F2),
  brightBlack: Color(0xFF6272A4),
  brightRed: Color(0xFFFF6E6E),
  brightGreen: Color(0xFF69FF94),
  brightYellow: Color(0xFFFFFFA5),
  brightBlue: Color(0xFFD6ACFF),
  brightMagenta: Color(0xFFFF92DF),
  brightCyan: Color(0xFFA4FFFF),
  brightWhite: Color(0xFFFFFFFF),
  searchHitBackground: Color(0xFFFFFF2B),
  searchHitBackgroundCurrent: Color(0xFF31FF26),
  searchHitForeground: Color(0xFF000000),
);

const TerminalTheme _solarizedDark = TerminalTheme(
  cursor: Color(0xFF93A1A1),
  selection: Color(0x55839496),
  foreground: Color(0xFF93A1A1),
  background: Color(0xFF002B36),
  black: Color(0xFF073642),
  red: Color(0xFFDC322F),
  green: Color(0xFF859900),
  yellow: Color(0xFFB58900),
  blue: Color(0xFF268BD2),
  magenta: Color(0xFFD33682),
  cyan: Color(0xFF2AA198),
  white: Color(0xFFEEE8D5),
  brightBlack: Color(0xFF586E75),
  brightRed: Color(0xFFCB4B16),
  brightGreen: Color(0xFF586E75),
  brightYellow: Color(0xFF657B83),
  brightBlue: Color(0xFF839496),
  brightMagenta: Color(0xFF6C71C4),
  brightCyan: Color(0xFF93A1A1),
  brightWhite: Color(0xFFFDF6E3),
  searchHitBackground: Color(0xFFFFFF2B),
  searchHitBackgroundCurrent: Color(0xFF31FF26),
  searchHitForeground: Color(0xFF000000),
);

const TerminalTheme _ghosttyDark = TerminalTheme(
  cursor: Color(0xFFF8F8F2),
  selection: Color(0x6644475A),
  foreground: Color(0xFFF8F8F2),
  background: Color(0xFF282A36),
  black: Color(0xFF191A21),
  red: Color(0xFFFF5555),
  green: Color(0xFF50FA7B),
  yellow: Color(0xFFFFB86C),
  blue: Color(0xFFBD93F9),
  magenta: Color(0xFFFF79C6),
  cyan: Color(0xFF8BE9FD),
  white: Color(0xFFF8F8F2),
  brightBlack: Color(0xFF6272A4),
  brightRed: Color(0xFFFF6E6E),
  brightGreen: Color(0xFF69FF94),
  brightYellow: Color(0xFFFFD866),
  brightBlue: Color(0xFFD6ACFF),
  brightMagenta: Color(0xFFFF92DF),
  brightCyan: Color(0xFFA4FFFF),
  brightWhite: Color(0xFFFFFFFF),
  searchHitBackground: Color(0xFFFFFF2B),
  searchHitBackgroundCurrent: Color(0xFF31FF26),
  searchHitForeground: Color(0xFF000000),
);

TerminalTheme resolveTerminalTheme(TerminalThemeId id) => switch (id) {
      TerminalThemeId.pickforgeEmber => _pickforgeEmber,
      TerminalThemeId.draculaDark => _draculaDark,
      TerminalThemeId.solarizedDark => _solarizedDark,
      TerminalThemeId.ghosttyDark => _ghosttyDark,
    };
