import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/ansi.dart';

void main() {
  test('strip removes CSI sequences', () {
    expect(stripAnsi('\x1B[31mred\x1B[0m plain'), 'red plain');
  });

  test('strip removes cursor-movement sequences', () {
    expect(stripAnsi('start\x1B[2J\x1B[Hend'), 'startend');
  });

  test('parseSpans returns ranges in stripped-text coordinates', () {
    const raw = '\x1B[31mred\x1B[0m\x1B[1mbold\x1B[0m';
    final r = parseAnsi(raw);
    expect(r.text, 'redbold');
    expect(r.spans, hasLength(2));
    expect(r.spans[0].start, 0);
    expect(r.spans[0].end, 3);
    expect(r.spans[0].fg, 1);
    expect(r.spans[1].start, 3);
    expect(r.spans[1].end, 7);
    expect(r.spans[1].bold, isTrue);
  });
}
