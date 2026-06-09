// The sample lines below are raw ANSI escape sequences that do not break
// across lines cleanly; keep them intact.
// ignore_for_file: lines_longer_than_80_chars

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/terminal/live_terminal_output.dart';
import 'package:pickforge/core/terminal/terminal_themes.dart';
import 'package:xterm/xterm.dart';

import '../support/golden_test_harness.dart';

/// Renders agent-style ANSI output through the real terminal pipeline
/// (`writeLiveTerminalOutput` → xterm `TerminalView`) using the brand theme,
/// to lock in: (a) colors render correctly, (b) underlines are stripped.
void main() {
  setUpAll(loadGoldenFonts);

  testWidgets(
    'embedded terminal renders agent ANSI on brand theme',
    (tester) async {
      const key = ValueKey('terminal-render-golden');

      // A cross-section of what Claude / Codex actually emit.
      const esc = '\x1B';
      const emberLine =
          '$esc[38;2;255;122;26mtruecolor ember$esc[0m  $esc[32mShipped$esc[0m  $esc[31mError$esc[0m  $esc[35mYOLO$esc[0m';
      const pathLine =
          '$esc[1mBold$esc[0m  $esc[90mmuted$esc[0m  $esc[34mlib/main.dart$esc[0m:$esc[33m42$esc[0m';
      final sample = [
        '$esc[38;5;208m>_ OpenAI Codex$esc[0m  $esc[90m(v0.138.0)$esc[0m',
        '$esc[1;36m1. Yes, continue$esc[0m   $esc[90m2. No, quit$esc[0m',
        '$esc[33mMCP warning: supabase failed to start$esc[0m',
        '$esc[4mthis text was underlined$esc[24m and this is not',
        emberLine,
        pathLine,
      ].join('\r\n');

      final terminal = Terminal(maxLines: 200, reflowEnabled: false);
      writeLiveTerminalOutput(terminal, sample);

      final theme = resolveTerminalTheme(TerminalThemeId.pickforgeEmber);

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        size: const Size(760, 220),
        child: ColoredBox(
          color: theme.background,
          child: TerminalView(
            terminal,
            theme: theme,
            textStyle: const TerminalStyle(
              fontFamily: 'GeistMono',
              fontFamilyFallback: ['JetBrains Mono', 'monospace'],
              fontSize: 14,
              height: 1.35,
            ),
            padding: const EdgeInsets.all(16),
          ),
        ),
      );

      await expectGolden(key, 'terminal_render');
    },
    skip: skipGoldenPlatform,
  );
}
