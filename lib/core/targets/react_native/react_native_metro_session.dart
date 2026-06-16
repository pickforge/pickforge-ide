import 'dart:async';
import 'dart:convert';

import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/targets/react_native/react_native_command.dart';
import 'package:pickforge/core/targets/react_native/react_native_command_builder.dart';
import 'package:pickforge/core/targets/react_native/react_native_log_parser.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';
import 'package:pickforge/core/targets/target_session.dart';

/// A running Metro development server for a React Native target.
///
/// Implements the generic [TargetSession] so the workbench can stop it like any
/// other target. Metro output is parsed into [RunSessionEvent]s on [events],
/// reusing PickForge's run-log stream.
///
/// [events] is single-subscription (one owner). The session best-effort drains
/// stdout and stderr before emitting the terminal `stopped` event so tail
/// output is not normally lost; [isRunning] flips to `false` on both `stop()`
/// and a natural Metro exit. The drain is bounded by a `drainTimeout` so a
/// lingering pipe fd (e.g. held by a Metro worker after the parent exits) can
/// never hang the session — and the terminal `stopped` event is always emitted.
class ReactNativeMetroSession implements TargetSession {
  ReactNativeMetroSession._(
    this._process,
    this._parser, {
    Duration drainTimeout = const Duration(seconds: 2),
  })  : _drainTimeout = drainTimeout,
        _controller = StreamController<RunSessionEvent>() {
    _wire();
  }

  final RunningProcess _process;
  final ReactNativeLogParser _parser;
  final Duration _drainTimeout;
  final StreamController<RunSessionEvent> _controller;
  bool _running = true;

  /// Parsed Metro log + lifecycle events. Listen at most once.
  Stream<RunSessionEvent> get events => _controller.stream;

  @override
  String get targetId => 'react_native_android';

  @override
  bool get isRunning => _running;

  int get pid => _process.pid;

  Future<int> get exitCode => _process.exitCode;

  @override
  Future<void> stop() async {
    if (!_running) return;
    _running = false;
    await _process.kill();
  }

  void _wire() {
    final subscriptions = <StreamSubscription<String>>[];
    final dones = <Future<void>>[];

    void pipe(Stream<List<int>> output) {
      final done = Completer<void>();
      dones.add(done.future);
      subscriptions.add(
        output.transform(utf8.decoder).transform(const LineSplitter()).listen(
          (line) {
            final event = _parser.metroEvent(line);
            if (event != null && !_controller.isClosed) {
              _controller.add(event);
            }
          },
          onError: (_) {
            if (!done.isCompleted) done.complete();
          },
          onDone: () {
            if (!done.isCompleted) done.complete();
          },
          cancelOnError: false,
        ),
      );
    }

    pipe(_process.stdout);
    pipe(_process.stderr);
    unawaited(_finish(dones, subscriptions));
  }

  Future<void> _finish(
    List<Future<void>> drains,
    List<StreamSubscription<String>> subscriptions,
  ) async {
    var code = -1;
    try {
      code = await _process.exitCode;
      // Drain buffered output before the terminal event, but never hang forever
      // if a stream stays open (an inherited pipe fd held by a Metro worker).
      await Future.wait(drains).timeout(
        _drainTimeout,
        onTimeout: () => const <void>[],
      );
    } on Object {
      // The terminal cleanup below must still run, so the session never gets
      // stuck "running" with an open controller if exitCode/drain errors.
    } finally {
      for (final subscription in subscriptions) {
        await subscription.cancel();
      }
      _running = false;
      if (!_controller.isClosed) {
        _controller.add(
          RunSessionEvent.stopped(exitCode: code, reason: 'metro_exited'),
        );
        await _controller.close();
      }
    }
  }
}

/// Starts [ReactNativeMetroSession]s by spawning Metro through a
/// [ProcessRunner] and wiring its output to the run-log parser.
class ReactNativeMetroSessionController {
  ReactNativeMetroSessionController(
    this._runner, {
    ReactNativeCommandBuilder commands = const ReactNativeCommandBuilder(),
    ReactNativeLogParser parser = const ReactNativeLogParser(),
    Duration drainTimeout = const Duration(seconds: 2),
  })  : _commands = commands,
        _parser = parser,
        _drainTimeout = drainTimeout;

  final ProcessRunner _runner;
  final ReactNativeCommandBuilder _commands;
  final ReactNativeLogParser _parser;
  final Duration _drainTimeout;

  Future<ReactNativeMetroSession> start({
    required ReactNativeProjectInfo project,
    ReactNativeMetroOptions options = const ReactNativeMetroOptions(),
  }) async {
    final command = _commands.metroStart(project: project, options: options);
    final process = await _runner.spawn(
      command.executable,
      command.arguments,
      cwd: command.cwd,
      env: command.env,
    );
    return ReactNativeMetroSession._(
      process,
      _parser,
      drainTimeout: _drainTimeout,
    );
  }
}
