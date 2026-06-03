import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_event_log_writer.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';

class _Settings extends Mock implements ProjectSettingsRepository {}

class _Discovery extends Mock implements DeviceDiscoveryService {}

class _Launcher extends Mock implements AvdLauncher {}

class _Poller extends Mock implements BootReadinessPoller {}

class _RunController extends Mock implements RunSessionController {}

class _LogRepo extends Mock implements RunSessionLogRepository {}

class _VmClient extends Mock implements VmServiceClient {}

class _RunSession extends Mock implements RunSession {}

class _RecordingEventLogWriter extends RunSessionEventLogWriter {
  final events = <RunSessionEvent>[];
  String? projectRoot;
  String? sessionId;

  @override
  Future<File> append({
    required String projectRoot,
    required String sessionId,
    required RunSessionEvent event,
    DateTime? timestamp,
  }) async {
    this.projectRoot = projectRoot;
    this.sessionId = sessionId;
    events.add(event);
    return File('/tmp/log.jsonl');
  }
}

void main() {
  test('vmServiceReady event reaches RunLogsCubit', () async {
    final logs = RunLogsCubit();
    final settings = _Settings();
    final run = _RunController();
    final logRepo = _LogRepo();
    final eventLogWriter = _RecordingEventLogWriter();
    final vm = _VmClient();
    final session = _RunSession();
    final events = StreamController<RunSessionEvent>.broadcast();
    when(() => settings.getRunArgs('/p'))
        .thenAnswer((_) async => const RunArgs());
    when(() => session.events).thenAnswer((_) => events.stream);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');
    when(() => session.sessionId).thenReturn('session-1');
    when(session.stop).thenAnswer((_) async {});
    when(
      () => run.start(
        projectRoot: '/p',
        serial: 'emulator-5554',
        targetFile: any(named: 'targetFile'),
        extraArgs: any(named: 'extraArgs'),
      ),
    ).thenAnswer((_) async => session);
    when(
      () => logRepo.recordStart(
        sessionId: any(named: 'sessionId'),
        projectRoot: any(named: 'projectRoot'),
        startedAt: any(named: 'startedAt'),
        connectionMode: any(named: 'connectionMode'),
        avdId: any(named: 'avdId'),
        avdName: any(named: 'avdName'),
        serial: any(named: 'serial'),
        vmServiceUrl: any(named: 'vmServiceUrl'),
      ),
    ).thenAnswer((_) async {});
    when(() => vm.connect(any())).thenAnswer((_) async {});

    final cubit = EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: _Discovery(),
      launcher: _Launcher(),
      poller: _Poller(),
      runController: run,
      logRepo: logRepo,
      vmClient: vm,
      logsCubit: logs,
      eventLogWriter: eventLogWriter,
    );
    addTearDown(cubit.close);
    addTearDown(events.close);

    cubit.emit(
      const EmulatorSessionState.idle(
        avd: Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );
    await cubit.runApp();
    events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
    await Future<void>.delayed(const Duration(milliseconds: 5));

    expect(logs.state.entries, isNotEmpty);
    expect(logs.state.entries.last.category, 'vm');
    expect(eventLogWriter.projectRoot, '/p');
    expect(eventLogWriter.sessionId, 'session-1');
    expect(eventLogWriter.events, [
      const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'),
    ]);
  });
}
