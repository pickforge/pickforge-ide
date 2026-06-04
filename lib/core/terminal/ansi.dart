class AnsiSpan {
  AnsiSpan({
    required this.start,
    required this.end,
    this.fg,
    this.bg,
    this.bold = false,
    this.italic = false,
    this.underline = false,
  });

  final int start;
  final int end;
  final int? fg;
  final int? bg;
  final bool bold;
  final bool italic;
  final bool underline;
}

class AnsiResult {
  AnsiResult(this.text, this.spans);

  final String text;
  final List<AnsiSpan> spans;
}

final _ansiRegex = RegExp(
  r'\x1B(?:\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]|\][^\x07]*\x07|\][^\x1B]*\x1B\\|[\x20-\x2F]*[\x30-\x7E])',
);

String stripAnsi(String input) => input.replaceAll(_ansiRegex, '');

AnsiResult parseAnsi(String input) {
  final spans = <AnsiSpan>[];
  final out = StringBuffer();
  int? fg;
  int? bg;
  var bold = false;
  var italic = false;
  var underline = false;
  var spanStart = 0;

  void flush() {
    if (out.length > spanStart &&
        (fg != null || bg != null || bold || italic || underline)) {
      spans.add(
        AnsiSpan(
          start: spanStart,
          end: out.length,
          fg: fg,
          bg: bg,
          bold: bold,
          italic: italic,
          underline: underline,
        ),
      );
    }
    spanStart = out.length;
  }

  var i = 0;
  while (i < input.length) {
    final m = _ansiRegex.matchAsPrefix(input, i);
    if (m != null) {
      flush();
      final seq = m.group(0)!;
      if (seq.length > 2 && seq[1] == '[' && seq.endsWith('m')) {
        final params = seq
            .substring(2, seq.length - 1)
            .split(';')
            .map((s) => s.isEmpty ? 0 : int.tryParse(s) ?? 0)
            .toList();
        for (final p in params) {
          if (p == 0) {
            fg = null;
            bg = null;
            bold = false;
            italic = false;
            underline = false;
          } else if (p == 1) {
            bold = true;
          } else if (p == 3) {
            italic = true;
          } else if (p == 4) {
            underline = true;
          } else if (p == 22) {
            bold = false;
          } else if (p == 23) {
            italic = false;
          } else if (p == 24) {
            underline = false;
          } else if (p >= 30 && p <= 37) {
            fg = p - 30;
          } else if (p >= 40 && p <= 47) {
            bg = p - 40;
          } else if (p == 39) {
            fg = null;
          } else if (p == 49) {
            bg = null;
          } else if (p >= 90 && p <= 97) {
            fg = p - 90 + 8;
          } else if (p >= 100 && p <= 107) {
            bg = p - 100 + 8;
          }
        }
      }
      i = m.end;
    } else {
      out.write(input[i]);
      i++;
    }
  }
  flush();
  return AnsiResult(out.toString(), spans);
}
