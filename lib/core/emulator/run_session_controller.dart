import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/json_rpc_line_decoder.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:uuid/uuid.dart';

class RunSession {
  RunSession._({
    required this.sessionId,
    required RunningProcess proc,
    required this.events,
    required Future<void> Function(bool fullRestart) sendReload,
    required Future<void> Function() sendStop,
  })  : _proc = proc,
        _sendReload = sendReload,
        _sendStop = sendStop;

  final String sessionId;
  final Stream<RunSessionEvent> events;
  final RunningProcess _proc;
  final Future<void> Function(bool fullRestart) _sendReload;
  final Future<void> Function() _sendStop;

  String? _appId;
  String? _vmServiceUri;
  bool _stopping = false;

  String? get appId => _appId;
  String? get vmServiceUri => _vmServiceUri;
  Future<int> get exitCode => _proc.exitCode;

  Future<bool> hotReload() async {
    await _sendReload(false);
    return true;
  }

  Future<bool> hotRestart() async {
    await _sendReload(true);
    return true;
  }

  Future<void> stop() async {
    if (_stopping) return;
    _stopping = true;
    try {
      await _sendStop().timeout(const Duration(seconds: 3));
    } on TimeoutException {
      await _proc.kill();
    }
    try {
      await exitCode.timeout(const Duration(seconds: 1));
    } on TimeoutException {
      await _proc.kill(signal: ProcessSignal.sigkill);
    }
  }
}

@lazySingleton
class RunSessionController {
  RunSessionController(this._runner);

  final ProcessRunner _runner;

  Future<RunSession> start({
    required String projectRoot,
    required String serial,
    String? targetFile,
    required List<String> extraArgs,
  }) async {
    final args = <String>[
      'run',
      '--machine',
      '-d',
      serial,
      if (targetFile != null) ...['--target', targetFile],
      ...extraArgs,
    ];
    final proc = await _runner.spawn('flutter', args, cwd: projectRoot);
    final controller = StreamController<RunSessionEvent>.broadcast();
    final decoder = JsonRpcLineDecoder();
    final pendingReplies = <int, Completer<DecodedResponse>>{};
    var nextId = 1;
    String? appId;

    Future<void> sendRequest(String method, Map<String, dynamic> params) async {
      final id = nextId++;
      final completer = Completer<DecodedResponse>();
      pendingReplies[id] = completer;
      proc.writeStdin(utf8.encode('${jsonEncode([
            {'id': id, 'method': method, 'params': params},
          ])}\n'));
      await completer.future.timeout(const Duration(seconds: 30),
          onTimeout: () {
        pendingReplies.remove(id);
        throw TimeoutException('flutter run did not respond to $method');
      });
    }

    late final RunSession session;
    session = RunSession._(
      sessionId: const Uuid().v4(),
      proc: proc,
      events: controller.stream,
      sendReload: (fullRestart) => sendRequest('app.restart', {
        'appId': appId,
        'fullRestart': fullRestart,
        'pause': false,
        'reason': fullRestart ? 'manual-restart' : 'manual',
      }),
      sendStop: () async {
        await proc.kill();
      },
    );

    proc.stderr.listen((_) {}); // drain to prevent back-pressure deadlock

    proc.stdout.listen((bytes) {
      decoder.feed(utf8.decode(bytes), (line) {
        switch (line) {
          case DecodedEnvelope(:final event, :final params):
            switch (event) {
              case 'app.start':
                appId = params['appId'] as String?;
                session._appId = appId;
                controller
                    .add(const RunSessionEvent.stage(message: 'Building...'));
              case 'app.debugPort':
                final wsUri = params['wsUri'] as String?;
                if (wsUri != null && session._vmServiceUri == null) {
                  session._vmServiceUri = wsUri;
                  controller.add(RunSessionEvent.vmServiceReady(uri: wsUri));
                }
              case 'app.started':
                final vmUri =
                    params['vmServiceUri'] as String? ?? session._vmServiceUri;
                if (vmUri != null && session._vmServiceUri == null) {
                  session._vmServiceUri = vmUri;
                  controller.add(RunSessionEvent.vmServiceReady(uri: vmUri));
                }
              case 'daemon.logMessage':
                controller.add(RunSessionEvent.log(
                  line: params['message'] as String? ?? '',
                  level: _parseLevel(params['level'] as String? ?? 'info'),
                ));
            }
          case DecodedResponse(:final id, :final result, :final error):
            pendingReplies.remove(id)?.complete(
                  DecodedResponse(id: id, result: result, error: error),
                );
          case DecodedRawLine(:final text):
            controller
                .add(RunSessionEvent.log(line: text, level: LogLevel.info));
        }
      });
    }, onDone: () async {
      final code = await proc.exitCode;
      controller.add(RunSessionEvent.stopped(
        exitCode: code,
        reason: code == 0 ? 'user_stop' : 'crash',
      ));
      await controller.close();
    });

    return session;
  }

  LogLevel _parseLevel(String value) => switch (value) {
        'warning' => LogLevel.warning,
        'error' => LogLevel.error,
        'status' => LogLevel.status,
        _ => LogLevel.info,
      };
}
