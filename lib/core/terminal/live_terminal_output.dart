import 'package:xterm/xterm.dart';

void writeLiveTerminalOutput(Terminal terminal, String data) {
  if (data.isEmpty) return;
  terminal.write(normalizeLiveTerminalOutput(data));
  removeTerminalUnderlines(terminal);
}

/// Everything a freshly spawned shell implies about terminal modes: mouse
/// reporting off, main screen, bracketed paste off, cursor visible, wrap on,
/// attributes reset. Shared between the live reset below and the transcript
/// recorder, which stamps it into the log whenever a new session opens over
/// old scrollback — so a replayed transcript can never strand the terminal
/// in a dead TUI's modes (stale mouse reporting turns every click into
/// escape-sequence garbage and breaks text selection).
const terminalModeResets = [
  '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l',
  '\x1b[?1049l',
  '\x1b[?47l',
  '\x1b[?2004l',
  '\x1b[?25h',
  '\x1b[?7h',
  '\x1b[0m',
];

/// Replayed transcripts can leave the terminal in modes the recorded session
/// enabled (mouse reporting, alt screen, bracketed paste, hidden cursor).
/// The freshly spawned shell never asked for those, so undo them before
/// attaching live output.
///
/// Each reset is written separately and defensively: replaying a transcript
/// that ends mid-TUI can leave xterm's buffer in a state where a mode switch
/// (notably leaving the alt screen) throws internally. One bad reset must
/// not abort the rest — and never the caller, which still has to attach the
/// live PTY.
void resetReplayedTerminalModes(Terminal terminal) {
  for (final reset in terminalModeResets) {
    try {
      terminal.write(reset);
    } on Object {
      // Defensive: see doc comment.
    }
  }
}

void removeTerminalUnderlines(Terminal terminal) {
  terminal.cursor.unsetUnderline();
  _removeBufferUnderlines(terminal.mainBuffer);
  _removeBufferUnderlines(terminal.altBuffer);
}

void _removeBufferUnderlines(Buffer buffer) {
  buffer.lines.forEach((line) {
    for (var i = 0; i < line.length; i++) {
      final attrs = line.getAttributes(i);
      if (attrs & CellAttr.underline != 0) {
        line.setAttributes(i, attrs & ~CellAttr.underline);
      }
    }
  });
}

final _sgrRegex = RegExp('\x1B\\[([0-9:;]*)m');

String normalizeLiveTerminalOutput(String data) {
  if (!data.contains('\x1B[')) return data;
  return data.replaceAllMapped(_sgrRegex, (match) {
    final params = match.group(1)!;
    final normalized = _normalizeSgrParams(params);
    if (normalized.isEmpty) return '';
    return '\x1B[${normalized.join(';')}m';
  });
}

List<String> _normalizeSgrParams(String params) {
  final normalized = <String>[];
  for (final part in params.split(';')) {
    normalized.addAll(_normalizeSgrPart(part));
  }
  return normalized;
}

List<String> _normalizeSgrPart(String part) {
  if (part.isEmpty) return const ['0'];
  if (!part.contains(':')) {
    final param = int.tryParse(part);
    return switch (param) {
      4 || 24 => const ['24'],
      58 || 59 => const [],
      _ => [part],
    };
  }

  final raw = part.split(':');
  final head = int.tryParse(raw.first);
  if (head == null) return const [];

  final nums = raw
      .where((s) => s.isNotEmpty)
      .map(int.tryParse)
      .whereType<int>()
      .toList(growable: false);

  switch (head) {
    case 38:
    case 48:
      return _normalizeExtendedColor(head, nums);
    case 4:
      return const ['24'];
    case 24:
      return const ['24'];
    case 58:
    case 59:
      return const [];
    default:
      return [head.toString()];
  }
}

List<String> _normalizeExtendedColor(int target, List<int> nums) {
  if (nums.length < 2) return const [];
  final mode = nums[1];
  if (mode == 5 && nums.length >= 3) {
    return [target.toString(), '5', nums.last.toString()];
  }
  if (mode == 2 && nums.length >= 5) {
    final rgb = nums.sublist(nums.length - 3);
    return [
      target.toString(),
      '2',
      rgb[0].toString(),
      rgb[1].toString(),
      rgb[2].toString(),
    ];
  }
  return const [];
}
