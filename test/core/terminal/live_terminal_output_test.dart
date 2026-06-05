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
    expect(first.flags & CellAttr.underline, CellAttr.underline);
    expect(second.flags & CellAttr.underline, 0);
  });
}
