import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _Settings extends Mock implements ProjectSettingsRepository {}

class _Discovery extends Mock implements DeviceDiscoveryService {}

class _Launcher extends Mock implements AvdLauncher {}

class _Poller extends Mock implements BootReadinessPoller {}

class _RunController extends Mock implements RunSessionController {}

class _LogRepo extends Mock implements RunSessionLogRepository {}

class _VmClient extends Mock implements VmServiceClient {}

class _IpcServer extends Mock implements EmulatorIpcServer {}

class _RunSession extends Mock implements RunSession {}

void main() {
  test('runApp binds IPC session and writes sock path', () async {
    final project = await Directory.systemTemp.createTemp('pf-project-');
    addTearDown(() => project.delete(recursive: true));

    final settings = _Settings();
    final run = _RunController();
    final logRepo = _LogRepo();
    final vm = _VmClient();
    final ipc = _IpcServer();
    final session = _RunSession();
    final events = StreamController<RunSessionEvent>.broadcast();
    addTearDown(events.close);

    when(() => settings.getRunArgs(project.path))
        .thenAnswer((_) async => const RunArgs());
    when(() => session.events).thenAnswer((_) => events.stream);
    when(() => session.sessionId).thenReturn('session-1');
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');
    when(() => session.stop()).thenAnswer((_) async {});
    when(() => ipc.socketPath).thenReturn('/tmp/pickforge-test.sock');
    when(() => ipc.bindActiveRunSession(any())).thenReturn(null);
    when(() => run.start(
          projectRoot: project.path,
          serial: 'emulator-5554',
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        )).thenAnswer((_) async => session);
    when(() => logRepo.recordStart(
          sessionId: any(named: 'sessionId'),
          projectRoot: any(named: 'projectRoot'),
          startedAt: any(named: 'startedAt'),
          connectionMode: any(named: 'connectionMode'),
          avdId: any(named: 'avdId'),
          avdName: any(named: 'avdName'),
          serial: any(named: 'serial'),
          vmServiceUrl: any(named: 'vmServiceUrl'),
        )).thenAnswer((_) async {});
    when(() => vm.connect(any())).thenAnswer((_) async {});

    final cubit = EmulatorSessionCubit(
      projectRoot: project.path,
      settings: settings,
      discovery: _Discovery(),
      launcher: _Launcher(),
      poller: _Poller(),
      runController: run,
      logRepo: logRepo,
      vmClient: vm,
      ipcServer: ipc,
    );
    addTearDown(cubit.close);
    cubit.emit(const EmulatorSessionState.idle(
      avd: Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android'),
      serial: 'emulator-5554',
    ));

    await cubit.runApp();

    verify(() => ipc.bindActiveRunSession(session)).called(1);
    final sockPath = File('${project.path}/.pickforge/ipc.sock-path');
    expect(await sockPath.readAsString(), '/tmp/pickforge-test.sock');
  });
}
