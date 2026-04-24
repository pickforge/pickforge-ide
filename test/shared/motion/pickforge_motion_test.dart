import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';

void main() {
  group('PickforgeMotion', () {
    test('fast duration is non-zero', () {
      expect(PickforgeMotion.fast.inMilliseconds, greaterThan(0));
    });

    test('standard duration is non-zero', () {
      expect(PickforgeMotion.standard.inMilliseconds, greaterThan(0));
    });

    test('slow duration is non-zero', () {
      expect(PickforgeMotion.slow.inMilliseconds, greaterThan(0));
    });

    test('durations are ordered fast < standard < slow', () {
      expect(
        PickforgeMotion.fast.inMilliseconds,
        lessThan(PickforgeMotion.standard.inMilliseconds),
      );
      expect(
        PickforgeMotion.standard.inMilliseconds,
        lessThan(PickforgeMotion.slow.inMilliseconds),
      );
    });

    test('curve is not null', () {
      expect(PickforgeMotion.curve, isNotNull);
    });

    test('curveOut is not null', () {
      expect(PickforgeMotion.curveOut, isNotNull);
    });
  });
}
