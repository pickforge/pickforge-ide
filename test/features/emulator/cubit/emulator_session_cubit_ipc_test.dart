import 'dart:async';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/projects/pickforge_project_directory.dart';
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

class _IpcServer extends Mock implements EmulatorIpcServer {}

class _RunSession extends Mock implements RunSession {}

class _ScreenshotCapturer extends Mock implements AdbScreenshotCapturer {}

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
    when(session.stop).thenAnswer((_) async {});
    when(() => ipc.socketPath).thenReturn('/tmp/pickforge-test.sock');
    when(() => ipc.bindActiveRunSession(any())).thenReturn(null);
    when(
      () => run.start(
        projectRoot: project.path,
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
        targetFile: any(named: 'targetFile'),
      ),
    ).thenAnswer((_) async {});
    when(
      () => logRepo.recordVmServiceUrl(
        sessionId: any(named: 'sessionId'),
        vmServiceUrl: any(named: 'vmServiceUrl'),
      ),
    ).thenAnswer((_) async {});
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
    cubit.emit(
      const EmulatorSessionState.idle(
        avd: Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );

    await cubit.runApp();

    verify(() => ipc.bindActiveRunSession(session)).called(1);
    final sockPath = File('${project.path}/.pickforge/ipc.sock-path');
    expect(await sockPath.readAsString(), '/tmp/pickforge-test.sock');
  });

  test('project IPC routes expose logs, context, history, and screenshots',
      () async {
    final project = await Directory.systemTemp.createTemp('pf-project-');
    addTearDown(() => project.delete(recursive: true));
    final pickforge = await PickforgeProjectDirectory.ensure(project.path);
    await File('${pickforge.path}/skill-active.md').writeAsString('skill');
    await File('${pickforge.path}/widget-context.md').writeAsString('widget');
    await File('${pickforge.path}/initial-prompt.md').writeAsString('prompt');
    await File('${pickforge.path}/screenshot.png').writeAsBytes([1, 2, 3]);

    final endpoint = await _createEndpoint();
    final ipc = EmulatorIpcServer(socketPath: endpoint.path);
    await ipc.start();
    addTearDown(ipc.stop);
    addTearDown(endpoint.dispose);

    final logs = RunLogsCubit()
      ..append(
        const RunSessionEvent.log(
          line: 'Reloaded 1 of 2 libraries',
          level: LogLevel.info,
        ),
      );
    addTearDown(logs.close);

    final db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    addTearDown(db.close);
    await db.pickHistoryDao.insertPick(
      projectRoot: project.path,
      widgetClass: 'ElevatedButton',
      creationFile: 'lib/main.dart',
      creationLine: 10,
      skillId: 'edit-widget',
      agentId: 'codex',
      terminalId: 'terminal',
      widgetContextJson: '{"node":{"className":"ElevatedButton"}}',
    );
    await db.pickHistoryDao.insertPick(
      projectRoot: '/other/project',
      widgetClass: 'Other',
      creationFile: null,
      creationLine: null,
      skillId: 'edit-widget',
      agentId: 'codex',
      terminalId: 'terminal',
      widgetContextJson: '{}',
    );

    final screenshot = _ScreenshotCapturer();
    when(
      () => screenshot.capture(
        outputDir: any(named: 'outputDir'),
        serial: any(named: 'serial'),
        platform: any(named: 'platform'),
      ),
    ).thenAnswer((_) async => '${pickforge.path}/device-screen.png');

    final cubit = EmulatorSessionCubit(
      projectRoot: project.path,
      settings: _Settings(),
      discovery: _Discovery(),
      launcher: _Launcher(),
      poller: _Poller(),
      runController: _RunController(),
      logRepo: _LogRepo(),
      vmClient: _VmClient(),
      logsCubit: logs,
      ipcServer: ipc,
      pickHistoryDao: db.pickHistoryDao,
      screenshotCapturer: screenshot,
    );
    addTearDown(cubit.close);
    cubit.emit(
      const EmulatorSessionState.idle(
        avd: Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );

    const client = EmulatorIpcClient();
    final history = await client.send(
      ipc.socketPath,
      {'id': 1, 'method': 'list_pickforge_history'},
    );
    final runLogs = await client.send(
      ipc.socketPath,
      {'id': 2, 'method': 'get_run_logs'},
    );
    final context = await client.send(
      ipc.socketPath,
      {'id': 3, 'method': 'get_project_context'},
    );
    final capture = await client.send(
      ipc.socketPath,
      {'id': 4, 'method': 'capture_screenshot'},
    );

    final historyResult = history['result'] as List<dynamic>;
    final historyRow = historyResult.single as Map<String, dynamic>;
    final runLogEntry =
        (runLogs['result'] as List<dynamic>).single as Map<String, dynamic>;
    final contextResult = context['result'] as Map<String, dynamic>;
    final contextFiles =
        (contextResult['files'] as List<dynamic>).cast<Map<String, dynamic>>();

    expect(historyResult, hasLength(1));
    expect(historyRow['widgetClass'], 'ElevatedButton');
    expect(runLogEntry['line'], 'Reloaded 1 of 2 libraries');
    expect(contextResult['projectRoot'], project.path);
    expect(
      contextFiles
          .where((file) => file['name'] == 'widget-context.md')
          .single['content'],
      'widget',
    );
    expect(capture, isNot(contains('error')), reason: capture.toString());
    expect(capture['result'], {
      'ok': true,
      'path': '${pickforge.path}/device-screen.png',
      'reason': null,
    });
    verify(
      () => screenshot.capture(
        outputDir: pickforge.path,
        serial: 'emulator-5554',
        platform: androidEmulatorPlatform,
      ),
    ).called(1);
  });
}

Future<_IpcEndpoint> _createEndpoint() async {
  if (Platform.isWindows) {
    return _IpcEndpoint(
      r'\\.\pipe\pickforge-test-' '${DateTime.now().microsecondsSinceEpoch}',
      () async {},
    );
  }
  final tmp = await Directory.systemTemp.createTemp('pf-ipc-');
  return _IpcEndpoint('${tmp.path}/sock', () => tmp.delete(recursive: true));
}

final class _IpcEndpoint {
  const _IpcEndpoint(this.path, this.dispose);

  final String path;
  final Future<void> Function() dispose;
}
