import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';

void main() {
  test('initial', () {
    expect(const DevicePickerState.initial(), const DevicePickerState.initial());
  });

  test('loaded equality', () {
    const avd = Avd(id: 'X', name: 'X', platform: 'android');
    const running = RunningAndroidDevice(
      serial: 'emulator-5554',
      avdName: 'X',
      state: 'device',
    );
    expect(
      const DevicePickerState.loaded(avds: [avd], running: [running]),
      const DevicePickerState.loaded(avds: [avd], running: [running]),
    );
  });
}
