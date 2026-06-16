import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/target_capability.dart';

void main() {
  group('TargetCapabilities', () {
    test('has() reports membership', () {
      const caps = TargetCapabilities({
        TargetCapability.detect,
        TargetCapability.streamLogs,
      });

      expect(caps.has(TargetCapability.detect), isTrue);
      expect(caps.has(TargetCapability.streamLogs), isTrue);
      expect(caps.has(TargetCapability.captureScreenshot), isFalse);
    });

    test('equality is by value', () {
      const a = TargetCapabilities({
        TargetCapability.detect,
        TargetCapability.launch,
      });
      const b = TargetCapabilities({
        TargetCapability.detect,
        TargetCapability.launch,
      });
      const c = TargetCapabilities({TargetCapability.detect});

      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
      expect(a, isNot(equals(c)));
    });

    test('none has no capabilities', () {
      expect(TargetCapabilities.none.values, isEmpty);
      expect(TargetCapabilities.none.has(TargetCapability.detect), isFalse);
    });
  });
}
