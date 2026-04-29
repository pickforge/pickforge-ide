import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}

class _MD extends Mock implements DeviceDiscoveryService {}

class _ML extends Mock implements AvdLauncher {}

class _MP extends Mock implements BootReadinessPoller {}

class _MR extends Mock implements RunSessionController {}

class _MLog extends Mock implements RunSessionLogRepository {}

class _MV extends Mock implements VmServiceClient {}

void main() {
  late _MV vm;
  late StreamController<VmServiceConnectionState> stateCtrl;
  setUp(() {
    vm = _MV();
    stateCtrl = StreamController<VmServiceConnectionState>.broadcast();
    when(() => vm.state).thenAnswer((_) => stateCtrl.stream);
    when(() => vm.currentUrl).thenReturn('ws://x');
  });
  tearDown(() => stateCtrl.close());
  EmulatorSessionCubit build() => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: _MS(),
      discovery: _MD(),
      launcher: _ML(),
      poller: _MP(),
      runController: _MR(),
      logRepo: _MLog(),
      vmClient: vm);
  const avd = Avd(id: 'X', name: 'X', platform: 'android');
  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'vm error from running -> reconnecting -> running on reconnect',
    build: build,
    seed: () => EmulatorSessionState.running(
        avd: avd,
        serial: 'emulator-5554',
        appId: 'a',
        vmServiceUri: 'ws://x',
        stats: RunStats()),
    act: (c) async {
      c.bindVmStateStream();
      stateCtrl.add(
          const VmServiceConnectionState.error(message: 'drop', attempt: 1));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      stateCtrl.add(const VmServiceConnectionState.connected(url: 'ws://x'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
    },
    expect: () => [isA<Reconnecting>(), isA<Running>()],
  );
}
