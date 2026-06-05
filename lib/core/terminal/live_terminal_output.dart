import 'package:xterm/xterm.dart';

void writeLiveTerminalOutput(Terminal terminal, String data) {
  if (data.isEmpty) return;
  terminal.write(normalizeLiveTerminalOutput(data));
  removeTerminalUnderlines(terminal);
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
