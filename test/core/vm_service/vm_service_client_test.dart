import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/vm_service/reconnect_policy.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:vm_service/vm_service.dart';

class _MockVmService extends Mock implements VmService {}

void main() {
  test('reconnectLoop emits connecting then error with incrementing attempts',
      () async {
    var calls = 0;
    final delays = <Duration>[];
    final client = VmServiceClient.forTesting(
      factory: (url) async {
        calls++;
        throw StateError('boom-$calls');
      },
      delay: (duration) async => delays.add(duration),
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
    expect(delays, [
      const Duration(milliseconds: 1),
      const Duration(milliseconds: 2),
    ]);

    await client.close();
  });

  test('failed reconnect clears stale service', () async {
    final staleService = _MockVmService();
    when(() => staleService.onDone).thenAnswer((_) => Completer<void>().future);
    when(staleService.dispose).thenAnswer((_) async {});
    var calls = 0;
    final client = VmServiceClient.forTesting(
      factory: (url) async {
        calls++;
        if (calls == 1) return staleService;
        throw StateError('boom');
      },
      delay: (_) async {},
    );

    await client.connect('ws://x/ws');
    expect(client.service, same(staleService));

    await client.reconnectLoop(
      'ws://x/ws',
      policy: const ExponentialBackoff(initial: Duration(milliseconds: 1)),
      maxAttempts: 1,
    );

    expect(client.service, isNull);
    verify(staleService.dispose).called(1);
    await client.close();
  });

  test('successful reconnect disposes and replaces stale service', () async {
    final oldService = _MockVmService();
    final newService = _MockVmService();
    when(() => oldService.onDone).thenAnswer((_) => Completer<void>().future);
    when(() => newService.onDone).thenAnswer((_) => Completer<void>().future);
    when(oldService.dispose).thenAnswer((_) async {});
    when(newService.dispose).thenAnswer((_) async {});
    var calls = 0;
    final client = VmServiceClient.forTesting(
      factory: (url) async => calls++ == 0 ? oldService : newService,
      delay: (_) async {},
    );

    await client.connect('ws://x/ws');
    await client.reconnectLoop(
      'ws://x/ws',
      policy: const ExponentialBackoff(initial: Duration(milliseconds: 1)),
      maxAttempts: 1,
    );

    expect(client.service, same(newService));
    verify(oldService.dispose).called(1);
    await client.close();
    verify(newService.dispose).called(1);
  });

  test('connect starts reconnect loop when live service closes', () async {
    final firstService = _MockVmService();
    final secondService = _MockVmService();
    final firstDone = Completer<void>();
    when(() => firstService.onDone).thenAnswer((_) => firstDone.future);
    when(() => secondService.onDone)
        .thenAnswer((_) => Completer<void>().future);
    when(firstService.dispose).thenAnswer((_) async {});
    when(secondService.dispose).thenAnswer((_) async {});
    var calls = 0;
    final client = VmServiceClient.forTesting(
      factory: (url) async => calls++ == 0 ? firstService : secondService,
      delay: (_) async {},
    );

    await client.connect('ws://x/ws');
    firstDone.complete();
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(client.service, same(secondService));
    expect(calls, 2);
    await client.close();
  });

  test('close stops reconnect loop during backoff', () async {
    var calls = 0;
    final delayStarted = Completer<void>();
    final releaseDelay = Completer<void>();
    final client = VmServiceClient.forTesting(
      factory: (url) async {
        calls++;
        throw StateError('boom');
      },
      delay: (_) async {
        delayStarted.complete();
        await releaseDelay.future;
      },
    );

    final reconnect = client.reconnectLoop(
      'ws://x/ws',
      policy: const ExponentialBackoff(initial: Duration(milliseconds: 1)),
      maxAttempts: 2,
    );
    await delayStarted.future;
    await client.close();
    releaseDelay.complete();
    await reconnect;

    expect(calls, 1);
  });

  test('close stops pending connect from publishing a late service', () async {
    final service = _MockVmService();
    when(() => service.onDone).thenAnswer((_) => Completer<void>().future);
    when(service.dispose).thenAnswer((_) async {});
    final factoryResult = Completer<VmService>();
    final client = VmServiceClient.forTesting(
      factory: (_) => factoryResult.future,
      delay: (_) async {},
    );

    final connect = client.connect('ws://x/ws');
    await client.close();
    factoryResult.complete(service);
    await connect;

    expect(client.service, isNull);
    verify(service.dispose).called(1);
  });
}
