import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/avd_shutdown_controller.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/emulator/run_session_recovery_store.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
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

class _Recovery extends Mock implements RunSessionRecoveryStore {}

class _Shutdown extends Mock implements AvdShutdownController {}

void main() {
  late _MS settings;
  late _MD disc;
  late _ML launcher;
  late _MP poller;
  late _MR run;
  late _MLog log;
  late _MV vm;
  late _Recovery recovery;
  late _Shutdown shutdown;
  late _FakeRunSession session;
  late StreamController<RunSessionEvent> events;

  setUpAll(() {
    registerFallbackValue(
      const EmulatorBinding.avd(avdId: 'fallback', avdName: 'fallback'),
    );
    registerFallbackValue(
      RunSessionRecoveryMetadata(
        sessionId: 'fallback',
        projectRoot: '/fallback',
        pid: 1,
        serial: 'emulator-5554',
        startedAt: DateTime.utc(2026, 6, 3),
      ),
    );
    registerFallbackValue(const EmulatorIdleShutdownSettings());
  });

  setUp(() {
    settings = _MS();
    disc = _MD();
    launcher = _ML();
    poller = _MP();
    run = _MR();
    log = _MLog();
    vm = _MV();
    recovery = _Recovery();
    shutdown = _Shutdown();
    session = _FakeRunSession();
    events = StreamController<RunSessionEvent>.broadcast();
    when(() => session.events).thenAnswer((_) => events.stream);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');
    when(() => session.sessionId).thenReturn('ses-1');
    when(() => session.pid).thenReturn(4242);
    when(() => session.hotReload()).thenAnswer((_) async => true);
    when(() => session.hotRestart()).thenAnswer((_) async => true);
    when(() => session.stop()).thenAnswer((_) async {});
    when(() => settings.getRunArgs('/p'))
        .thenAnswer((_) async => const RunArgs());
    when(() => settings.getEmulatorIdleShutdownSettings('/p'))
        .thenAnswer((_) async => const EmulatorIdleShutdownSettings());
    when(
      () => log.recordStart(
        sessionId: any(named: 'sessionId'),
        projectRoot: any(named: 'projectRoot'),
        startedAt: any(named: 'startedAt'),
        connectionMode: any(named: 'connectionMode'),
        avdId: any(named: 'avdId'),
        avdName: any(named: 'avdName'),
        serial: any(named: 'serial'),
        vmServiceUrl: any(named: 'vmServiceUrl'),
        targetFile: any(named: 'targetFile'),
      ),
    ).thenAnswer((_) async {});
    when(
      () => log.recordVmServiceUrl(
        sessionId: any(named: 'sessionId'),
        vmServiceUrl: any(named: 'vmServiceUrl'),
      ),
    ).thenAnswer((_) async {});
    when(
      () => log.recordEnd(
        sessionId: any(named: 'sessionId'),
        endedAt: any(named: 'endedAt'),
        exitReason: any(named: 'exitReason'),
        exitCode: any(named: 'exitCode'),
        hotReloadCount: any(named: 'hotReloadCount'),
        hotRestartCount: any(named: 'hotRestartCount'),
        errorCount: any(named: 'errorCount'),
        lastError: any(named: 'lastError'),
      ),
    ).thenAnswer((_) async {});
    when(() => vm.connect(any())).thenAnswer((_) async {});
    when(() => recovery.persist(any())).thenAnswer((_) async {});
    when(() => recovery.remove(any())).thenAnswer((_) async {});
    when(() => recovery.cleanup(any())).thenAnswer((_) async {});
    when(() => recovery.findRecoverable('/p')).thenAnswer((_) async => null);
    when(() => shutdown.shutdown(any())).thenAnswer((_) async {});
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
        vmClient: vm,
      );
  const avd =
      Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');
  const physicalAvd = Avd(
    id: 'R58M1234567',
    name: 'Pixel 6',
    platform: androidPhysicalPlatform,
  );
  const physicalDevice = RunningAndroidDevice(
    serial: 'R58M1234567',
    avdName: null,
    state: 'device',
    kind: AndroidDeviceKind.physical,
    model: 'Pixel 6',
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootstrap offers adoption for recoverable orphaned run',
    setUp: () {
      when(() => recovery.findRecoverable('/p')).thenAnswer(
        (_) async => RunSessionRecoveryMetadata(
          sessionId: 'ses-1',
          projectRoot: '/p',
          pid: 4242,
          serial: 'emulator-5554',
          startedAt: DateTime.utc(2026, 6, 3),
          avdId: 'Pixel_10',
          avdName: 'Pixel 10',
          vmServiceUri: 'ws://x/ws',
        ),
      );
    },
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      recoveryStore: recovery,
    ),
    act: (c) => c.bootstrap(),
    expect: () => [
      isA<RecoveryPending>()
          .having((s) => s.canAdopt, 'canAdopt', isTrue)
          .having((s) => s.pid, 'pid', 4242),
    ],
    verify: (_) => verifyNever(() => settings.getEmulatorBinding('/p')),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'adoptRecoveredRun connects to saved VM service',
    setUp: () {
      when(() => recovery.findRecoverable('/p')).thenAnswer(
        (_) async => RunSessionRecoveryMetadata(
          sessionId: 'ses-1',
          projectRoot: '/p',
          pid: 4242,
          serial: 'emulator-5554',
          startedAt: DateTime.utc(2026, 6, 3),
          avdId: 'Pixel_10',
          avdName: 'Pixel 10',
          vmServiceUri: 'ws://x/ws',
          appId: 'app-1',
        ),
      );
    },
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      recoveryStore: recovery,
    ),
    act: (c) async {
      await c.bootstrap();
      await c.adoptRecoveredRun();
    },
    expect: () => [
      isA<RecoveryPending>(),
      isA<Running>()
          .having((s) => s.recovered, 'recovered', isTrue)
          .having((s) => s.vmServiceUri, 'vmServiceUri', 'ws://x/ws'),
    ],
    verify: (_) => verify(() => vm.connect('ws://x/ws')).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'cleanupRecoveredRun kills safe orphan and returns to device state',
    setUp: () {
      when(() => recovery.findRecoverable('/p')).thenAnswer(
        (_) async => RunSessionRecoveryMetadata(
          sessionId: 'ses-1',
          projectRoot: '/p',
          pid: 4242,
          serial: 'emulator-5554',
          startedAt: DateTime.utc(2026, 6, 3),
          avdId: 'Pixel_10',
          avdName: 'Pixel 10',
        ),
      );
      when(() => settings.getEmulatorBinding('/p')).thenAnswer(
        (_) async => null,
      );
    },
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      recoveryStore: recovery,
    ),
    act: (c) async {
      await c.bootstrap();
      when(() => recovery.findRecoverable('/p')).thenAnswer((_) async => null);
      await c.cleanupRecoveredRun();
    },
    expect: () => [isA<RecoveryPending>(), isA<NoDevicePicked>()],
    verify: (_) => verify(
      () => recovery.cleanup(
        any(
          that: isA<RunSessionRecoveryMetadata>().having(
            (m) => m.sessionId,
            'sessionId',
            'ses-1',
          ),
        ),
      ),
    ).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootstrap restores connected physical device binding',
    setUp: () {
      when(() => settings.getEmulatorBinding('/p')).thenAnswer(
        (_) async => const EmulatorBinding.physical(
          serial: 'R58M1234567',
          name: 'Pixel 6',
        ),
      );
      when(disc.snapshot).thenAnswer(
        (_) async => const DeviceListSnapshot(
          avds: [],
          running: [physicalDevice],
        ),
      );
    },
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [
      isA<Idle>()
          .having((s) => s.avd, 'avd', physicalAvd)
          .having((s) => s.serial, 'serial', 'R58M1234567'),
    ],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootstrap reports disconnected physical device binding',
    setUp: () {
      when(() => settings.getEmulatorBinding('/p')).thenAnswer(
        (_) async => const EmulatorBinding.physical(
          serial: 'R58M1234567',
          name: 'Pixel 6',
        ),
      );
      when(disc.snapshot).thenAnswer(
        (_) async => const DeviceListSnapshot(avds: [], running: []),
      );
    },
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [
      isA<EmulatorError>().having((s) => s.avd, 'avd', physicalAvd).having(
            (s) => s.message,
            'message',
            'Physical device R58M1234567 is not connected',
          ),
    ],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'pickPhysicalDevice persists serial and enters idle',
    setUp: () {
      when(() => settings.setEmulatorBinding('/p', any()))
          .thenAnswer((_) async {});
    },
    build: build,
    act: (c) => c.pickPhysicalDevice(physicalDevice),
    expect: () => [
      isA<Idle>()
          .having((s) => s.avd, 'avd', physicalAvd)
          .having((s) => s.serial, 'serial', 'R58M1234567'),
    ],
    verify: (_) => verify(
      () => settings.setEmulatorBinding(
        '/p',
        const EmulatorBinding.physical(
          serial: 'R58M1234567',
          name: 'Pixel 6',
        ),
      ),
    ).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'runApp from idle attaches inspector on vmServiceReady',
    setUp: () => when(
      () => run.start(
        projectRoot: '/p',
        serial: 'emulator-5554',
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'),
      ),
    ).thenAnswer((_) async => session),
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
    'runApp persists recovery metadata and removes it on stop',
    setUp: () => when(
      () => run.start(
        projectRoot: '/p',
        serial: 'emulator-5554',
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'),
      ),
    ).thenAnswer((_) async => session),
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      recoveryStore: recovery,
    ),
    seed: () =>
        const EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await c.stopRun();
    },
    expect: () => [isA<Running>(), isA<Idle>()],
    verify: (_) {
      verify(
        () => recovery.persist(
          any(
            that: isA<RunSessionRecoveryMetadata>()
                .having((m) => m.pid, 'pid', 4242)
                .having((m) => m.ipcSocketPath, 'ipcSocketPath', isNull),
          ),
        ),
      ).called(greaterThanOrEqualTo(1));
      verify(
        () => recovery.remove(
          any(that: isA<RunSessionRecoveryMetadata>()),
        ),
      ).called(1);
    },
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'runApp records target file on session start',
    setUp: () {
      when(() => settings.getRunArgs('/p')).thenAnswer(
        (_) async => const RunArgs(targetFile: 'lib/main_dev.dart'),
      );
      when(
        () => run.start(
          projectRoot: '/p',
          serial: 'emulator-5554',
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        ),
      ).thenAnswer((_) async => session);
    },
    build: build,
    seed: () =>
        const EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    act: (c) async {
      await c.runApp();
    },
    verify: (_) {
      verify(
        () => run.start(
          projectRoot: '/p',
          serial: 'emulator-5554',
          targetFile: 'lib/main_dev.dart',
          extraArgs: const [],
        ),
      ).called(1);
      verify(
        () => log.recordStart(
          sessionId: 'ses-1',
          projectRoot: '/p',
          startedAt: any(named: 'startedAt'),
          connectionMode: 'auto',
          avdId: 'Pixel_5_API_34',
          avdName: 'Pixel 5 API 34',
          serial: 'emulator-5554',
          vmServiceUrl: 'ws://x/ws',
          targetFile: 'lib/main_dev.dart',
        ),
      ).called(1);
    },
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'runApp from physical device uses selected serial',
    setUp: () {
      when(
        () => run.start(
          projectRoot: '/p',
          serial: 'R58M1234567',
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        ),
      ).thenAnswer((_) async => session);
    },
    build: build,
    seed: () => const EmulatorSessionState.idle(
      avd: physicalAvd,
      serial: 'R58M1234567',
    ),
    act: (c) async {
      await c.runApp();
    },
    verify: (_) {
      verify(
        () => run.start(
          projectRoot: '/p',
          serial: 'R58M1234567',
          targetFile: any(named: 'targetFile'),
          extraArgs: const [],
        ),
      ).called(1);
      verify(
        () => log.recordStart(
          sessionId: 'ses-1',
          projectRoot: '/p',
          startedAt: any(named: 'startedAt'),
          connectionMode: 'auto',
          avdId: 'R58M1234567',
          avdName: 'Pixel 6',
          serial: 'R58M1234567',
          vmServiceUrl: 'ws://x/ws',
          targetFile: any(named: 'targetFile'),
        ),
      ).called(1);
    },
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'stopRun calls session.stop and goes to idle',
    setUp: () => when(
      () => run.start(
        projectRoot: '/p',
        serial: any(named: 'serial'),
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'),
      ),
    ).thenAnswer((_) async => session),
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
    'stopped event prompts before idle shutdown by default',
    setUp: () {
      when(() => settings.getEmulatorIdleShutdownSettings('/p')).thenAnswer(
        (_) async => const EmulatorIdleShutdownSettings(enabled: true),
      );
      when(
        () => run.start(
          projectRoot: '/p',
          serial: any(named: 'serial'),
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        ),
      ).thenAnswer((_) async => session);
    },
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      shutdownController: shutdown,
    ),
    seed: () => const EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
    ),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      events.add(const RunSessionEvent.stopped(exitCode: 0, reason: 'stopped'));
      await Future<void>.delayed(const Duration(milliseconds: 10));
    },
    expect: () => [
      isA<Running>(),
      isA<Idle>()
          .having((s) => s.shutdownPrompt, 'shutdownPrompt', isTrue)
          .having((s) => s.idleSince, 'idleSince', isNotNull),
    ],
    verify: (_) => verifyNever(() => shutdown.shutdown(any())),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'confirmIdleShutdown kills emulator and returns to cold state',
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      shutdownController: shutdown,
    ),
    seed: () => EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
      idleSince: DateTime.utc(2026, 6, 3),
      shutdownPrompt: true,
    ),
    act: (c) => c.confirmIdleShutdown(),
    expect: () => [const EmulatorSessionState.cold(avd: avd)],
    verify: (_) => verify(() => shutdown.shutdown('emulator-5554')).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'dismissIdleShutdownPrompt keeps idle emulator',
    build: build,
    seed: () => EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
      idleSince: DateTime.utc(2026, 6, 3),
      shutdownPrompt: true,
    ),
    act: (c) => c.dismissIdleShutdownPrompt(),
    expect: () => [
      EmulatorSessionState.idle(
        avd: avd,
        serial: 'emulator-5554',
        idleSince: DateTime.utc(2026, 6, 3),
      ),
    ],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'explicit automatic idle shutdown skips prompt',
    setUp: () {
      when(() => settings.getEmulatorIdleShutdownSettings('/p')).thenAnswer(
        (_) async => const EmulatorIdleShutdownSettings(
          enabled: true,
          requireConfirmation: false,
        ),
      );
      when(
        () => run.start(
          projectRoot: '/p',
          serial: any(named: 'serial'),
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        ),
      ).thenAnswer((_) async => session);
    },
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      shutdownController: shutdown,
    ),
    seed: () => const EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
    ),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await c.stopRun();
    },
    expect: () => [
      isA<Running>(),
      const EmulatorSessionState.cold(avd: avd),
    ],
    verify: (_) => verify(() => shutdown.shutdown('emulator-5554')).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'physical device skips automatic idle shutdown',
    setUp: () {
      when(() => settings.getEmulatorIdleShutdownSettings('/p')).thenAnswer(
        (_) async => const EmulatorIdleShutdownSettings(
          enabled: true,
          requireConfirmation: false,
        ),
      );
      when(
        () => run.start(
          projectRoot: '/p',
          serial: any(named: 'serial'),
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        ),
      ).thenAnswer((_) async => session);
    },
    build: () => EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: disc,
      launcher: launcher,
      poller: poller,
      runController: run,
      logRepo: log,
      vmClient: vm,
      shutdownController: shutdown,
    ),
    seed: () => const EmulatorSessionState.idle(
      avd: physicalAvd,
      serial: 'R58M1234567',
    ),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await c.stopRun();
    },
    expect: () => [
      isA<Running>(),
      isA<Idle>()
          .having((s) => s.avd, 'avd', physicalAvd)
          .having((s) => s.serial, 'serial', 'R58M1234567')
          .having((s) => s.shutdownPrompt, 'shutdownPrompt', isFalse),
    ],
    verify: (_) => verifyNever(() => shutdown.shutdown(any())),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'reloadCompleted records lastReloadAt on running state',
    setUp: () => when(
      () => run.start(
        projectRoot: '/p',
        serial: any(named: 'serial'),
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'),
      ),
    ).thenAnswer((_) async => session),
    build: build,
    seed: () => const EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
    ),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      events.add(
        const RunSessionEvent.reloadCompleted(
          success: true,
          fullRestart: false,
          durationMs: 120,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 5));
    },
    expect: () => [
      isA<Running>(),
      isA<Running>().having((s) => s.lastReloadAt, 'lastReloadAt', isNotNull),
    ],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'stopped event records run summary',
    setUp: () => when(
      () => run.start(
        projectRoot: '/p',
        serial: any(named: 'serial'),
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'),
      ),
    ).thenAnswer((_) async => session),
    build: build,
    seed: () => const EmulatorSessionState.idle(
      avd: avd,
      serial: 'emulator-5554',
    ),
    act: (c) async {
      await c.runApp();
      events
        ..add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'))
        ..add(const RunSessionEvent.log(line: 'boom', level: LogLevel.error))
        ..add(
          const RunSessionEvent.reloadCompleted(
            success: true,
            fullRestart: false,
            durationMs: 120,
          ),
        )
        ..add(
          const RunSessionEvent.reloadCompleted(
            success: true,
            fullRestart: true,
            durationMs: 300,
          ),
        )
        ..add(const RunSessionEvent.stopped(exitCode: 1, reason: 'crash'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
    },
    expect: () => [
      isA<Running>(),
      isA<Running>(),
      isA<Running>(),
      isA<Idle>(),
    ],
    verify: (_) {
      verify(
        () => log.recordEnd(
          sessionId: 'ses-1',
          endedAt: any(named: 'endedAt'),
          exitReason: 'crash',
          exitCode: 1,
          hotReloadCount: 1,
          hotRestartCount: 1,
          errorCount: 1,
          lastError: 'boom',
        ),
      ).called(1);
    },
  );
}
