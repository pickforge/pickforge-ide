import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';

void main() {
  test('union exhaustiveness via when', () {
    const s = VmServiceConnectionState.connected(url: 'ws://x/ws');
    final label = s.when(
      idle: () => 'idle',
      connecting: (a) => 'c:$a',
      connected: (u) => 'ok:$u',
      error: (m, a) => 'e:$m:$a',
    );
    expect(label, 'ok:ws://x/ws');
  });
}
