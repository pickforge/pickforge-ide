import 'package:xterm/xterm.dart';

void writeLiveTerminalOutput(Terminal terminal, String data) {
  if (data.isEmpty) return;
  terminal.write(data);
}
