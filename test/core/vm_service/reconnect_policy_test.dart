import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/reconnect_policy.dart';

void main() {
  test('ExponentialBackoff produces 1s, 2s, 4s, 8s, 8s ...', () {
    const p = ExponentialBackoff();
    expect(p.delayFor(1), const Duration(seconds: 1));
    expect(p.delayFor(2), const Duration(seconds: 2));
    expect(p.delayFor(3), const Duration(seconds: 4));
    expect(p.delayFor(4), const Duration(seconds: 8));
    expect(p.delayFor(5), const Duration(seconds: 8));
  });
}
