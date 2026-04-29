import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';

void main() {
  test('starts not cancelled', () {
    final token = CancelToken();
    expect(token.isCancelled, isFalse);
  });

  test('cancel flips flag and fires onCancel once', () {
    final token = CancelToken();
    var fired = 0;
    token.onCancel(() => fired++);
    token.cancel();
    token.cancel();
    expect(token.isCancelled, isTrue);
    expect(fired, 1);
  });

  test('throwIfCancelled throws CancelledException after cancel', () {
    final token = CancelToken();
    token.cancel();
    expect(token.throwIfCancelled, throwsA(isA<CancelledException>()));
  });

  test('listener registered after cancel still fires synchronously', () {
    final token = CancelToken()..cancel();
    var fired = 0;
    token.onCancel(() => fired++);
    expect(fired, 1);
  });
}
