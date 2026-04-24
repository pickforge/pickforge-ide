import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';

void main() {
  test('InspectorStatus sealed union exhausts in when', () {
    const status = InspectorStatus.connected(selectModeOn: true);
    final label = status.when(
      disconnected: () => 'd',
      connecting: () => 'c',
      connected: (mode) => 'ok:$mode',
      error: (msg) => 'e:$msg',
    );
    expect(label, 'ok:true');
  });
}
