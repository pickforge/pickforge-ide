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
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}

class _MD extends Mock implements DeviceDiscoveryService {}

class _ML extends Mock implements AvdLauncher {}

class _MP extends Mock implements BootReadinessPoller {}

class _MR extends Mock implements RunSessionController {}

class _MLog extends Mock implements RunSessionLogRepository {}

class _MV extends Mock implements VmServiceClient {}

class _FakeRunSession extends Mock implements RunSession {}

void main() {
  late _MS settings;
  late _MD disc;
  late _ML launcher;
  late _MP poller;
  late _MR run;
  late _MLog log;
  late _MV vm;
  late _FakeRunSession session;
  late StreamController<RunSessionEvent> events;

  setUp(() {
    settings = _MS();
    disc = _MD();
    launcher = _ML();
    poller = _MP();
    run = _MR();
    log = _MLog();
    vm = _MV();
    session = _FakeRunSession();
    events = StreamController<RunSessionEvent>.broadcast();
    when(() => session.events).thenAnswer((_) => events.stream);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');
    when(() => session.sessionId).thenReturn('ses-1');
    when(() => session.hotReload()).thenAnswer((_) async => true);
    when(() => session.hotRestart()).thenAnswer((_) async => true);
    when(() => session.stop()).thenAnswer((_) async {});
    when(() => settings.getRunArgs('/p'))
        .thenAnswer((_) async => const RunArgs());
    when(() => log.recordStart(
        sessionId: any(named: 'sessionId'),
        projectRoot: any(named: 'projectRoot'),
        startedAt: any(named: 'startedAt'),
        connectionMode: any(named: 'connectionMode'),
        avdId: any(named: 'avdId'),
        avdName: any(named: 'avdName'),
        serial: any(named: 'serial'),
        vmServiceUrl: any(named: 'vmServiceUrl'))).thenAnswer((_) async {});
    when(() => vm.connect(any())).thenAnswer((_) async {});
  });
  tearDown(() => events.close());

  EmulatorSessionCubit build() => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm);
  const avd =
      Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'runApp from idle attaches inspector on vmServiceReady',
    setUp: () => when(() => run.start(
        projectRoot: '/p',
        serial: 'emulator-5554',
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'))).thenAnswer((_) async => session),
    build: build,
    seed: () =>
        const EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
    },
    expect: () => [isA<Running>().having((s) => s.manual, 'manual', false)],
    verify: (_) => verify(() => vm.connect('ws://x/ws')).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'stopRun calls session.stop and goes to idle',
    setUp: () => when(() => run.start(
        projectRoot: '/p',
        serial: any(named: 'serial'),
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'))).thenAnswer((_) async => session),
    build: build,
    seed: () =>
        const EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await c.stopRun();
    },
    expect: () => [isA<Running>(), isA<Idle>()],
    verify: (_) => verify(() => session.stop()).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'reloadCompleted records lastReloadAt on running state',
    setUp: () => when(() => run.start(
          projectRoot: '/p',
          serial: any(named: 'serial'),
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        )).thenAnswer((_) async => session),
    build: build,
    seed: () => const EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
    ),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      events.add(const RunSessionEvent.reloadCompleted(
        success: true,
        fullRestart: false,
        durationMs: 120,
      ));
      await Future<void>.delayed(const Duration(milliseconds: 5));
    },
    expect: () => [
      isA<Running>(),
      isA<Running>().having((s) => s.lastReloadAt, 'lastReloadAt', isNotNull),
    ],
  );
}
