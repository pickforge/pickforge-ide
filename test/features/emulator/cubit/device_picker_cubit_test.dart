import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';

class _MockDiscovery extends Mock implements DeviceDiscoveryService {}

void main() {
  blocTest<DevicePickerCubit, DevicePickerState>(
    'refresh emits loading then loaded',
    build: () {
      final discovery = _MockDiscovery();
      when(discovery.snapshot).thenAnswer(
        (_) async => const DeviceListSnapshot(
          avds: [Avd(id: 'X', name: 'X', platform: 'android')],
          running: [],
        ),
      );
      return DevicePickerCubit(discovery);
    },
    act: (cubit) => cubit.refresh(),
    expect: () => [const DevicePickerState.loading(), isA<Loaded>()],
  );
}
