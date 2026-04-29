import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

void main() {
  test('all variants construct + equate', () {
    const avd = Avd(id: 'X', name: 'Y', platform: 'android');
    expect(
      const EmulatorSessionState.noDevicePicked(),
      const EmulatorSessionState.noDevicePicked(),
    );
    expect(
      const EmulatorSessionState.cold(avd: avd),
      const EmulatorSessionState.cold(avd: avd),
    );
    expect(
      EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
      EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    );
    expect(
      EmulatorSessionState.running(
        avd: avd,
        serial: 'emulator-5554',
        appId: 'a',
        vmServiceUri: 'ws://x',
        stats: RunStats(startedAt: DateTime.utc(2026, 4, 28)),
        manual: false,
      ),
      isA<EmulatorSessionState>(),
    );
  });
}
