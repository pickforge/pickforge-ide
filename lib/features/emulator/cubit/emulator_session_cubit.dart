import 'dart:async';
import 'dart:io';

import 'package:bloc/bloc.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/avd_shutdown_controller.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_event_log_writer.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/emulator/run_session_recovery_store.dart';
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
    this.recoveryStore,
    this.shutdownController,
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
  final RunSessionRecoveryStore? recoveryStore;
  final AvdShutdownController? shutdownController;

  CancelToken? _bootCancel;
  AvdLaunchHandle? _bootHandle;
  RunSession? _activeSession;
  StreamSubscription<RunSessionEvent>? _eventsSub;
  StreamSubscription<VmServiceConnectionState>? _vmSub;
  Avd? _pendingRunAvd;
  String? _pendingRunSerial;
  int _hotReloadCount = 0;
  int _hotRestartCount = 0;
  int _errorCount = 0;
  String? _lastError;
  RunSessionRecoveryMetadata? _activeRecovery;

  Future<void> bootstrap() async {
    final recovery = await recoveryStore?.findRecoverable(projectRoot);
    if (recovery != null) {
      _activeRecovery = recovery;
      emit(_recoveryState(recovery));
      return;
    }
    final binding = await settings.getEmulatorBinding(projectRoot);
    if (binding == null) {
      emit(const EmulatorSessionState.noDevicePicked());
      return;
    }
    switch (binding) {
      case ManualBinding(:final vmServiceUrl):
        await _attachManual(vmServiceUrl);
      case AvdBinding(:final avdId, :final avdName):
        final avd = Avd(
          id: avdId,
          name: avdName,
          platform: androidEmulatorPlatform,
        );
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(_idleState(avd, running.serial));
        } else {
          emit(EmulatorSessionState.cold(avd: avd));
        }
      case PhysicalDeviceBinding(:final serial, :final name):
        final avd = Avd(
          id: serial,
          name: name,
          platform: androidPhysicalPlatform,
        );
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(_idleState(avd, running.serial));
        } else {
          emit(
            EmulatorSessionState.error(
              avd: avd,
              serial: serial,
              message: 'Physical device $serial is not connected',
            ),
          );
        }
      case IosSimulatorBinding(:final simulatorId, :final name):
        final avd = Avd(
          id: simulatorId,
          name: name,
          platform: iosSimulatorPlatform,
        );
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(_idleState(avd, running.serial));
        } else {
          emit(EmulatorSessionState.cold(avd: avd));
        }
      case WebTargetBinding(:final targetId, :final name):
        final avd = Avd(
          id: targetId,
          name: name,
          platform: flutterWebPlatform,
        );
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(_idleState(avd, running.serial));
        } else {
          emit(
            EmulatorSessionState.error(
              avd: avd,
              serial: targetId,
              message: 'Web target $targetId is not available',
            ),
          );
        }
      case DesktopTargetBinding(:final targetId, :final name):
        final avd = Avd(
          id: targetId,
          name: name,
          platform: flutterDesktopPlatform,
        );
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(_idleState(avd, running.serial));
        } else {
          emit(
            EmulatorSessionState.error(
              avd: avd,
              serial: targetId,
              message: 'Desktop target $targetId is not available',
            ),
          );
        }
    }
  }

  Future<void> pickAvd(Avd avd) async {
    if (avd.platform == iosSimulatorPlatform) {
      await settings.setEmulatorBinding(
        projectRoot,
        EmulatorBinding.iosSimulator(simulatorId: avd.id, name: avd.name),
      );
      final snap = await discovery.snapshot();
      final running = snap.runningFor(avd);
      if (running != null && running.state == 'device') {
        emit(_idleState(avd, running.serial));
      } else {
        emit(EmulatorSessionState.cold(avd: avd));
      }
      return;
    }
    if (avd.platform == flutterWebPlatform) {
      await settings.setEmulatorBinding(
        projectRoot,
        EmulatorBinding.webTarget(targetId: avd.id, name: avd.name),
      );
      final snap = await discovery.snapshot();
      final running = snap.runningFor(avd);
      if (running != null && running.state == 'device') {
        emit(_idleState(avd, running.serial));
      } else {
        emit(
          EmulatorSessionState.error(
            avd: avd,
            serial: avd.id,
            message: 'Web target ${avd.id} is not available',
          ),
        );
      }
      return;
    }
    if (avd.platform == flutterDesktopPlatform) {
      await settings.setEmulatorBinding(
        projectRoot,
        EmulatorBinding.desktopTarget(targetId: avd.id, name: avd.name),
      );
      final snap = await discovery.snapshot();
      final running = snap.runningFor(avd);
      if (running != null && running.state == 'device') {
        emit(_idleState(avd, running.serial));
      } else {
        emit(
          EmulatorSessionState.error(
            avd: avd,
            serial: avd.id,
            message: 'Desktop target ${avd.id} is not available',
          ),
        );
      }
      return;
    }
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.avd(avdId: avd.id, avdName: avd.name),
    );
    final snap = await discovery.snapshot();
    final running = snap.runningFor(avd);
    if (running != null && running.state == 'device') {
      emit(_idleState(avd, running.serial));
    } else {
      emit(EmulatorSessionState.cold(avd: avd));
    }
  }

  Future<void> pickPhysicalDevice(RunningAndroidDevice device) async {
    final avd = device.asDeviceAvd;
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.physical(
        serial: device.serial,
        name: device.displayName,
      ),
    );
    if (device.state == 'device') {
      emit(_idleState(avd, device.serial));
    } else {
      emit(
        EmulatorSessionState.error(
          avd: avd,
          serial: device.serial,
          message: 'Physical device ${device.serial} is ${device.state}',
        ),
      );
    }
  }

  Future<void> pickIosSimulator(RunningAndroidDevice device) async {
    final avd = device.asDeviceAvd;
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.iosSimulator(
        simulatorId: device.serial,
        name: device.displayName,
      ),
    );
    if (device.state == 'device') {
      emit(_idleState(avd, device.serial));
    } else {
      emit(
        EmulatorSessionState.error(
          avd: avd,
          serial: device.serial,
          message: 'iOS simulator ${device.serial} is ${device.state}',
        ),
      );
    }
  }

  Future<void> pickWebTarget(RunningAndroidDevice device) async {
    final avd = device.asDeviceAvd;
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.webTarget(
        targetId: device.serial,
        name: device.displayName,
      ),
    );
    if (device.state == 'device') {
      emit(_idleState(avd, device.serial));
    } else {
      emit(
        EmulatorSessionState.error(
          avd: avd,
          serial: device.serial,
          message: 'Web target ${device.serial} is ${device.state}',
        ),
      );
    }
  }

  Future<void> pickDesktopTarget(RunningAndroidDevice device) async {
    final avd = device.asDeviceAvd;
    await settings.setEmulatorBinding(
      projectRoot,
      EmulatorBinding.desktopTarget(
        targetId: device.serial,
        name: device.displayName,
      ),
    );
    if (device.state == 'device') {
      emit(_idleState(avd, device.serial));
    } else {
      emit(
        EmulatorSessionState.error(
          avd: avd,
          serial: device.serial,
          message: 'Desktop target ${device.serial} is ${device.state}',
        ),
      );
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
      final options = await settings.getEmulatorLaunchOptions(projectRoot);
      final handle = await launcher.launch(avd.id, options: options);
      _bootHandle = handle;
      await for (final event in poller.poll(
        avdId: avd.id,
        platform: avd.platform,
        cancel: cancel,
      )) {
        if (state is! Booting) return;
        switch (event) {
          case BootPending():
            break;
          case BootReady(:final serial):
            emit(_idleState(avd, serial));
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
    _resetRunSummary();
    final startedAt = DateTime.now();
    final session = await runController.start(
      projectRoot: projectRoot,
      serial: current.serial,
      targetFile: args.targetFile,
      extraArgs: args.extraArgs,
    );
    if (recoveryStore != null) {
      _activeRecovery = RunSessionRecoveryMetadata(
        sessionId: session.sessionId,
        projectRoot: projectRoot,
        pid: session.pid,
        serial: current.serial,
        startedAt: startedAt,
        avdId: current.avd.id,
        avdName: current.avd.name,
        avdPlatform: current.avd.platform,
        targetFile: args.targetFile,
        extraArgs: args.extraArgs,
      );
      await _persistRecovery();
    }
    _pendingRunAvd = current.avd;
    _pendingRunSerial = current.serial;
    _activeSession = session;
    await logRepo.recordStart(
      sessionId: session.sessionId,
      projectRoot: projectRoot,
      startedAt: startedAt,
      connectionMode: 'auto',
      avdId: current.avd.id,
      avdName: current.avd.name,
      serial: current.serial,
      vmServiceUrl: session.vmServiceUri,
      targetFile: args.targetFile,
    );
    await _eventsSub?.cancel();
    _eventsSub = session.events.listen(_onRunEvent);
    final ipcSocketPath = await _bindIpc(session);
    if (ipcSocketPath != null) {
      _activeRecovery = _activeRecovery?.copyWith(
        ipcSocketPath: ipcSocketPath,
      );
      await _persistRecovery();
    }
  }

  void _onRunEvent(RunSessionEvent event) {
    final session = _activeSession;
    if (session != null) {
      unawaited(_appendEventLog(session, event));
    }
    logsCubit?.append(event);
    event.when(
      stage: (_) {},
      log: (line, level, _) {
        if (level == LogLevel.error) {
          _errorCount++;
          _lastError = line;
        }
      },
      vmServiceReady: (uri) => unawaited(_handleVmServiceReady(uri)),
      stopped: (exitCode, reason) =>
          unawaited(_handleRunStopped(exitCode, reason)),
      reloadCompleted: (success, fullRestart, _, __, hint) {
        if (success) {
          if (fullRestart) {
            _hotRestartCount++;
          } else {
            _hotReloadCount++;
          }
        } else {
          _errorCount++;
          _lastError = hint ??
              (fullRestart ? 'Hot restart failed' : 'Hot reload failed');
        }
        final current = state;
        if (current is! Running) return;
        emit(
          current.copyWith(
            lastReloadAt: DateTime.now(),
            stats: current.stats.copyWith(
              hotReloadCount: _hotReloadCount,
              hotRestartCount: _hotRestartCount,
            ),
          ),
        );
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
    final session = _activeSession;
    if (session != null) {
      _activeRecovery = _activeRecovery?.copyWith(
        vmServiceUri: uri,
        appId: session.appId,
      );
      await _persistRecovery();
      unawaited(
        logRepo.recordVmServiceUrl(
          sessionId: session.sessionId,
          vmServiceUrl: uri,
        ),
      );
    }
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
        hotReloadCount: _hotReloadCount,
        hotRestartCount: _hotRestartCount,
        errorCount: _errorCount,
        lastError: _lastError,
      );
    }
    _activeSession = null;
    await _removeRecovery();
    await _unbindIpc();
    await _eventsSub?.cancel();
    _eventsSub = null;
    if (current is Running && current.avd != null && current.serial != null) {
      await _emitIdleAfterRun(current.avd!, current.serial!);
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
    final session = _activeSession;
    if (session == null && _activeRecovery != null) {
      await cleanupRecoveredRun();
      return;
    }
    await session?.stop();
    if (session != null) {
      await logRepo.recordEnd(
        sessionId: session.sessionId,
        endedAt: DateTime.now(),
        exitReason: 'user_stop',
        exitCode: 0,
        hotReloadCount: _hotReloadCount,
        hotRestartCount: _hotRestartCount,
        errorCount: _errorCount,
        lastError: _lastError,
      );
    }
    await _eventsSub?.cancel();
    _eventsSub = null;
    _activeSession = null;
    await _removeRecovery();
    await _unbindIpc();
    if (current is Running && current.avd != null && current.serial != null) {
      await _emitIdleAfterRun(current.avd!, current.serial!);
    }
  }

  Future<void> confirmIdleShutdown() async {
    final current = state;
    if (current is! Idle) return;
    await _shutdownIdleDevice(current);
  }

  void dismissIdleShutdownPrompt() {
    final current = state;
    if (current is! Idle || !current.shutdownPrompt) return;
    emit(current.copyWith(shutdownPrompt: false));
  }

  Future<void> adoptRecoveredRun() async {
    final recovery = _activeRecovery;
    if (recovery == null || !recovery.canAdopt) return;
    final uri = recovery.vmServiceUri!;
    try {
      await vmClient.connect(uri);
      emit(
        EmulatorSessionState.running(
          avd: _avdFromRecovery(recovery),
          serial: recovery.serial,
          appId: recovery.appId,
          vmServiceUri: uri,
          stats: RunStats(startedAt: recovery.startedAt),
          recovered: true,
        ),
      );
    } on Object catch (e) {
      emit(
        EmulatorSessionState.error(
          message: e.toString(),
          avd: _avdFromRecovery(recovery),
          serial: recovery.serial,
          lastVmServiceUri: uri,
        ),
      );
    }
  }

  Future<void> cleanupRecoveredRun() async {
    final recovery = _activeRecovery;
    if (recovery == null) return;
    await recoveryStore?.cleanup(recovery);
    _activeRecovery = null;
    await _unbindIpc();
    await bootstrap();
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

  Future<String?> _bindIpc(RunSession session) async {
    final server = ipcServer;
    if (server == null) return null;
    server.bindActiveRunSession(session);
    final dir = await PickforgeProjectDirectory.ensure(projectRoot);
    File('${dir.path}/ipc.sock-path').writeAsStringSync(server.socketPath);
    return server.socketPath;
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

  void _resetRunSummary() {
    _hotReloadCount = 0;
    _hotRestartCount = 0;
    _errorCount = 0;
    _lastError = null;
  }

  Idle _idleState(Avd avd, String serial, {bool shutdownPrompt = false}) {
    return Idle(
      avd: avd,
      serial: serial,
      idleSince: DateTime.now(),
      shutdownPrompt: shutdownPrompt,
    );
  }

  Future<void> _emitIdleAfterRun(Avd avd, String serial) async {
    final idle = _idleState(avd, serial);
    if (avd.platform != androidEmulatorPlatform) {
      emit(idle);
      return;
    }
    final settings = await this.settings.getEmulatorIdleShutdownSettings(
          projectRoot,
        );
    if (!settings.enabled) {
      emit(idle);
      return;
    }
    if (settings.requireConfirmation) {
      emit(idle.copyWith(shutdownPrompt: true));
      return;
    }
    await _shutdownIdleDevice(idle);
  }

  Future<void> _shutdownIdleDevice(Idle idle) async {
    if (idle.avd.platform != androidEmulatorPlatform) {
      emit(idle.copyWith(shutdownPrompt: false));
      return;
    }
    final controller = shutdownController;
    if (controller == null) {
      emit(idle.copyWith(shutdownPrompt: false));
      return;
    }
    try {
      await controller.shutdown(idle.serial);
      emit(EmulatorSessionState.cold(avd: idle.avd));
    } on Object catch (e) {
      emit(
        EmulatorSessionState.error(
          message: e.toString(),
          avd: idle.avd,
          serial: idle.serial,
        ),
      );
    }
  }

  EmulatorSessionState _recoveryState(RunSessionRecoveryMetadata recovery) {
    return EmulatorSessionState.recoveryPending(
      sessionId: recovery.sessionId,
      pid: recovery.pid,
      serial: recovery.serial,
      startedAt: recovery.startedAt,
      avd: _avdFromRecovery(recovery),
      vmServiceUri: recovery.vmServiceUri,
      canAdopt: recovery.canAdopt,
    );
  }

  Avd? _avdFromRecovery(RunSessionRecoveryMetadata recovery) {
    final id = recovery.avdId;
    final name = recovery.avdName;
    if (id == null || name == null) return null;
    return Avd(
      id: id,
      name: name,
      platform: recovery.avdPlatform ??
          (recovery.serial.startsWith('emulator-')
              ? androidEmulatorPlatform
              : androidPhysicalPlatform),
    );
  }

  Future<void> _persistRecovery() async {
    final recovery = _activeRecovery;
    final store = recoveryStore;
    if (recovery == null || store == null) return;
    try {
      await store.persist(recovery);
    } on Object {
      return;
    }
  }

  Future<void> _removeRecovery() async {
    final recovery = _activeRecovery;
    final store = recoveryStore;
    if (recovery == null || store == null) {
      _activeRecovery = null;
      return;
    }
    try {
      await store.remove(recovery);
    } on Object {
      _activeRecovery = null;
      return;
    }
    _activeRecovery = null;
  }

  @override
  Future<void> close() async {
    _bootCancel?.cancel();
    await _bootHandle?.cancel();
    await _unbindIpc();
    await _activeSession?.stop();
    if (_activeSession != null) {
      await _removeRecovery();
    }
    await _eventsSub?.cancel();
    await _vmSub?.cancel();
    return super.close();
  }
}
