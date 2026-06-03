import 'dart:async';
import 'dart:io';

import 'package:bloc/bloc.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_event_log_writer.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/projects/pickforge_project_directory.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';

class EmulatorSessionCubit extends Cubit<EmulatorSessionState> {
  EmulatorSessionCubit({
    required this.projectRoot,
    required this.settings,
    required this.discovery,
    required this.launcher,
    required this.poller,
    required this.runController,
    required this.logRepo,
    required this.vmClient,
    this.logsCubit,
    this.ipcServer,
    this.eventLogWriter = const RunSessionEventLogWriter(),
  }) : super(const EmulatorSessionState.noDevicePicked());

  final String projectRoot;
  final ProjectSettingsRepository settings;
  final DeviceDiscoveryService discovery;
  final AvdLauncher launcher;
  final BootReadinessPoller poller;
  final RunSessionController runController;
  final RunSessionLogRepository logRepo;
  final VmServiceClient vmClient;
  final RunLogsCubit? logsCubit;
  final EmulatorIpcServer? ipcServer;
  final RunSessionEventLogWriter eventLogWriter;

  CancelToken? _bootCancel;
  AvdLaunchHandle? _bootHandle;
  RunSession? _activeSession;
  StreamSubscription<RunSessionEvent>? _eventsSub;
  StreamSubscription<VmServiceConnectionState>? _vmSub;
  Avd? _pendingRunAvd;
  String? _pendingRunSerial;

  Future<void> bootstrap() async {
    final binding = await settings.getEmulatorBinding(projectRoot);
    if (binding == null) {
      emit(const EmulatorSessionState.noDevicePicked());
      return;
    }
    switch (binding) {
      case ManualBinding(:final vmServiceUrl):
        await _attachManual(vmServiceUrl);
      case AvdBinding(:final avdId, :final avdName):
        final avd = Avd(id: avdId, name: avdName, platform: 'android');
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(EmulatorSessionState.idle(avd: avd, serial: running.serial));
        } else {
          emit(EmulatorSessionState.cold(avd: avd));
        }
    }
  }

  Future<void> pickAvd(Avd avd) async {
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.avd(avdId: avd.id, avdName: avd.name),
    );
    final snap = await discovery.snapshot();
    final running = snap.runningFor(avd);
    if (running != null && running.state == 'device') {
      emit(EmulatorSessionState.idle(avd: avd, serial: running.serial));
    } else {
      emit(EmulatorSessionState.cold(avd: avd));
    }
  }

  Future<void> submitManualUrl(String url) async {
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.manual(vmServiceUrl: url),
    );
    await _attachManual(url);
  }

  Future<void> forgetDevice() async {
    await settings.clearEmulatorBinding(projectRoot);
    emit(const EmulatorSessionState.noDevicePicked());
  }

  Future<void> bootAvd() async {
    final current = state;
    if (current is! Cold) return;
    final avd = current.avd;
    emit(EmulatorSessionState.booting(avd: avd));
    final cancel = CancelToken();
    _bootCancel = cancel;
    try {
      final handle = await launcher.launch(avd.id);
      _bootHandle = handle;
      await for (final event in poller.poll(avdId: avd.id, cancel: cancel)) {
        if (state is! Booting) return;
        switch (event) {
          case BootPending():
            break;
          case BootReady(:final serial):
            emit(EmulatorSessionState.idle(avd: avd, serial: serial));
            return;
          case BootTimeout():
            await handle.cancel();
            emit(
              EmulatorSessionState.error(
                avd: avd,
                message: 'Boot timed out',
              ),
            );
            return;
          case BootCancelled():
            await handle.cancel();
            emit(EmulatorSessionState.cold(avd: avd));
            return;
          case BootError(:final message):
            await handle.cancel();
            emit(EmulatorSessionState.error(avd: avd, message: message));
            return;
        }
      }
    } finally {
      _bootCancel = null;
      _bootHandle = null;
    }
  }

  void cancelBoot() {
    _bootCancel?.cancel();
  }

  Future<void> runApp() async {
    final current = state;
    if (current is! Idle) return;
    final args = await settings.getRunArgs(projectRoot);
    final session = await runController.start(
      projectRoot: projectRoot,
      serial: current.serial,
      targetFile: args.targetFile,
      extraArgs: args.extraArgs,
    );
    _pendingRunAvd = current.avd;
    _pendingRunSerial = current.serial;
    _activeSession = session;
    await logRepo.recordStart(
      sessionId: session.sessionId,
      projectRoot: projectRoot,
      startedAt: DateTime.now(),
      connectionMode: 'auto',
      avdId: current.avd.id,
      avdName: current.avd.name,
      serial: current.serial,
      vmServiceUrl: session.vmServiceUri,
    );
    await _eventsSub?.cancel();
    _eventsSub = session.events.listen(_onRunEvent);
    await _bindIpc(session);
  }

  void _onRunEvent(RunSessionEvent event) {
    final session = _activeSession;
    if (session != null) {
      unawaited(_appendEventLog(session, event));
    }
    logsCubit?.append(event);
    event.when(
      stage: (_) {},
      log: (_, __, ___) {},
      vmServiceReady: (uri) => unawaited(_handleVmServiceReady(uri)),
      stopped: (exitCode, reason) =>
          unawaited(_handleRunStopped(exitCode, reason)),
      reloadCompleted: (_, __, ___, ____, _____) {
        final current = state;
        if (current is! Running) return;
        emit(current.copyWith(lastReloadAt: DateTime.now()));
      },
    );
  }

  Future<void> _appendEventLog(
    RunSession session,
    RunSessionEvent event,
  ) async {
    try {
      await eventLogWriter.append(
        projectRoot: projectRoot,
        sessionId: session.sessionId,
        event: event,
      );
    } on Object {
      // In-memory logs and run state must not depend on best-effort disk logs.
    }
  }

  Future<void> _handleVmServiceReady(String uri) async {
    final current = state;
    final avd = current is Running ? current.avd : _pendingRunAvd;
    final serial = current is Running ? current.serial : _pendingRunSerial;
    try {
      await vmClient.connect(uri);
    } on Object {
      // VmServiceClient exposes connection errors through its state stream.
    }
    emit(
      EmulatorSessionState.running(
        avd: avd,
        serial: serial,
        appId: _activeSession?.appId,
        vmServiceUri: uri,
        stats: current is Running ? current.stats : RunStats(),
      ),
    );
  }

  Future<void> _handleRunStopped(int exitCode, String reason) async {
    final current = state;
    final session = _activeSession;
    if (session != null) {
      await logRepo.recordEnd(
        sessionId: session.sessionId,
        endedAt: DateTime.now(),
        exitReason: reason,
        exitCode: exitCode,
      );
    }
    _activeSession = null;
    await _unbindIpc();
    await _eventsSub?.cancel();
    _eventsSub = null;
    if (current is Running && current.avd != null && current.serial != null) {
      emit(
        EmulatorSessionState.idle(
          avd: current.avd!,
          serial: current.serial!,
        ),
      );
    }
  }

  Future<void> hotReload() async {
    await _activeSession?.hotReload();
  }

  Future<void> hotRestart() async {
    await _activeSession?.hotRestart();
  }

  Future<void> stopRun() async {
    final current = state;
    await _activeSession?.stop();
    await _eventsSub?.cancel();
    _eventsSub = null;
    _activeSession = null;
    await _unbindIpc();
    if (current is Running && current.avd != null && current.serial != null) {
      emit(
        EmulatorSessionState.idle(
          avd: current.avd!,
          serial: current.serial!,
        ),
      );
    }
  }

  void bindVmStateStream() {
    unawaited(_vmSub?.cancel());
    _vmSub = vmClient.state.listen(_onVmState);
  }

  void _onVmState(VmServiceConnectionState vmState) {
    vmState.when(
      idle: () {},
      connecting: (_) {},
      connected: (url) {
        final current = state;
        if (current is Reconnecting) {
          emit(
            EmulatorSessionState.running(
              avd: current.avd,
              serial: current.serial,
              appId: current.appId,
              vmServiceUri: vmClient.currentUrl ?? url,
              stats: RunStats(),
            ),
          );
        }
      },
      error: (_, __) {
        final current = state;
        if (current is Running &&
            !current.manual &&
            current.avd != null &&
            current.serial != null) {
          emit(
            EmulatorSessionState.reconnecting(
              avd: current.avd!,
              serial: current.serial!,
              appId: current.appId ?? '',
            ),
          );
        }
      },
    );
  }

  Future<void> _attachManual(String url) async {
    try {
      await vmClient.connect(url);
      emit(
        EmulatorSessionState.running(
          vmServiceUri: url,
          stats: RunStats(),
          manual: true,
        ),
      );
    } on Object catch (e) {
      emit(
        EmulatorSessionState.error(
          message: e.toString(),
          lastVmServiceUri: url,
        ),
      );
    }
  }

  Future<void> _bindIpc(RunSession session) async {
    final server = ipcServer;
    if (server == null) return;
    server.bindActiveRunSession(session);
    final dir = await PickforgeProjectDirectory.ensure(projectRoot);
    File('${dir.path}/ipc.sock-path').writeAsStringSync(server.socketPath);
  }

  Future<void> _unbindIpc() async {
    final server = ipcServer;
    if (server == null) return;
    server.bindActiveRunSession(null);
    final file = File('$projectRoot/.pickforge/ipc.sock-path');
    if (file.existsSync()) {
      file.deleteSync();
    }
  }

  @override
  Future<void> close() async {
    _bootCancel?.cancel();
    await _bootHandle?.cancel();
    await _unbindIpc();
    await _activeSession?.stop();
    await _eventsSub?.cancel();
    await _vmSub?.cancel();
    return super.close();
  }
}
