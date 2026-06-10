import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/live_terminal_output.dart';
import 'package:xterm/xterm.dart';

void main() {
  test('preserves cursor-control sequences for live TUI output', () {
    final terminal = Terminal();

    writeLiveTerminalOutput(terminal, 'loading\r\x1b[2Kready');

    final text = terminal.buffer.getText();
    expect(text, contains('ready'));
    expect(text, isNot(contains('loading')));
    expect(text, isNot(contains('readyng')));
  });

  test('normalizes colon-form truecolor sequences for xterm parser', () {
    final terminal = Terminal();

    writeLiveTerminalOutput(terminal, '\x1b[38:2::218:92:74mX\x1b[0m');

    final cell = CellData.empty();
    terminal.buffer.lines[0].getCellData(0, cell);
    expect(cell.foreground & CellColor.typeMask, CellColor.rgb);
    expect(cell.foreground & CellColor.valueMask, 0xDA5C4A);
  });

  test('normalizes colon-form underline reset sequences', () {
    final terminal = Terminal();

    writeLiveTerminalOutput(terminal, '\x1b[4:1mA\x1b[24:1mB');

    final first = CellData.empty();
    final second = CellData.empty();
    terminal.buffer.lines[0].getCellData(0, first);
    terminal.buffer.lines[0].getCellData(1, second);
    expect(first.flags & CellAttr.underline, 0);
    expect(second.flags & CellAttr.underline, 0);
  });

  test('suppresses standard underline sequences', () {
    final terminal = Terminal();

    writeLiveTerminalOutput(terminal, '\x1b[4mA\x1b[24mB');

    final first = CellData.empty();
    final second = CellData.empty();
    terminal.buffer.lines[0].getCellData(0, first);
    terminal.buffer.lines[0].getCellData(1, second);
    expect(first.flags & CellAttr.underline, 0);
    expect(second.flags & CellAttr.underline, 0);
  });

  test('clears underline from split escape sequences', () {
    final terminal = Terminal();

    writeLiveTerminalOutput(terminal, '\x1b[');
    writeLiveTerminalOutput(terminal, '4mA\x1b[24mB');

    final first = CellData.empty();
    final second = CellData.empty();
    terminal.buffer.lines[0].getCellData(0, first);
    terminal.buffer.lines[0].getCellData(1, second);
    expect(first.flags & CellAttr.underline, 0);
    expect(second.flags & CellAttr.underline, 0);
    expect(terminal.cursor.isUnderline, isFalse);
  });

  test('clears underline already present in terminal buffer', () {
    final terminal = Terminal()..write('\x1b[4mA');

    writeLiveTerminalOutput(terminal, 'B');

    final first = CellData.empty();
    final second = CellData.empty();
    terminal.buffer.lines[0].getCellData(0, first);
    terminal.buffer.lines[0].getCellData(1, second);
    expect(first.flags & CellAttr.underline, 0);
    expect(second.flags & CellAttr.underline, 0);
    expect(terminal.cursor.isUnderline, isFalse);
  });

  test('preserves standard truecolor sequences', () {
    final terminal = Terminal();

    writeLiveTerminalOutput(terminal, '\x1b[38;2;215;119;87mX\x1b[0m');

    final cell = CellData.empty();
    terminal.buffer.lines[0].getCellData(0, cell);
    expect(cell.foreground & CellColor.typeMask, CellColor.rgb);
    expect(cell.foreground & CellColor.valueMask, 0xD77757);
  });

  group('resetReplayedTerminalModes', () {
    test('disables mouse reporting left on by a replayed TUI session', () {
      final terminal = Terminal()..write('\x1b[?1002h\x1b[?1006h');
      expect(terminal.mouseMode, isNot(MouseMode.none));

      resetReplayedTerminalModes(terminal);

      expect(terminal.mouseMode, MouseMode.none);
    });

    test('leaves the alt screen left active by a replayed TUI session', () {
      final terminal = Terminal()..write('\x1b[?1049h');
      expect(terminal.isUsingAltBuffer, isTrue);

      resetReplayedTerminalModes(terminal);

      expect(terminal.isUsingAltBuffer, isFalse);
    });

    test('clears bracketed paste so the live shell owns the mode', () {
      final terminal = Terminal()..write('\x1b[?2004h');
      expect(terminal.bracketedPasteMode, isTrue);

      resetReplayedTerminalModes(terminal);

      expect(terminal.bracketedPasteMode, isFalse);
    });
  });
}
