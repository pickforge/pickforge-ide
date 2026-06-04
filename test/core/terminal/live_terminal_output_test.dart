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
}
