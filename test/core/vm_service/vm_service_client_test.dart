import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/reconnect_policy.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';

void main() {
  test('reconnectLoop emits connecting then error with incrementing attempts',
      () async {
    var calls = 0;
    final client = VmServiceClient.forTesting(
      factory: (url) async {
        calls++;
        throw StateError('boom-$calls');
      },
    );
    const policy = ExponentialBackoff(
      initial: Duration(milliseconds: 1),
      cap: Duration(milliseconds: 4),
    );

    final events = <VmServiceConnectionState>[];
    final sub = client.state.listen(events.add);

    await client.reconnectLoop('ws://x/ws', policy: policy, maxAttempts: 3);
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();

    expect(calls, 3);
    final errorAttempts = events
        .map(
          (e) => e.maybeWhen(
            error: (_, attempt) => attempt,
            orElse: () => null,
          ),
        )
        .whereType<int>()
        .toList();
    expect(errorAttempts, [1, 2, 3]);

    await client.close();
  });
}
