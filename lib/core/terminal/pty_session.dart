import 'dart:async';
import 'dart:convert';
import 'dart:io' as io;

import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';

class PtySession {
  PtySession({
    required this.chatId,
    required this.executable,
    required this.arguments,
    required this.workingDirectory,
    required PtyProcessFactory factory,
    this.environment,
    this.onOutput,
    Duration spawnTimeout = const Duration(seconds: 8),
  })  : _factory = factory,
        _spawnTimeout = spawnTimeout;

  final String chatId;
  final String executable;
  final List<String> arguments;
  final String workingDirectory;
  final Map<String, String>? environment;
  final void Function(List<int> bytes)? onOutput;
  final PtyProcessFactory _factory;
  final Duration _spawnTimeout;

  final _stateCtrl = StreamController<PtySessionState>.broadcast();
  final _outputCtrl = StreamController<List<int>>.broadcast();
  PtyProcess? _process;
  PtySessionState _last = const PtyParked();

  Stream<PtySessionState> get state => Stream<PtySessionState>.multi((sub) {
        sub.add(_last);
        final s = _stateCtrl.stream.listen(sub.add);
        sub.onCancel = s.cancel;
      });

  Stream<List<int>> get output => _outputCtrl.stream;

  PtySessionState get currentState => _last;

  bool get isRunning => _last is PtyRunning;

  Future<void> start() async {
    _emit(const PtySpawning());
    try {
      _process = await _factory
          .start(
            executable: executable,
            arguments: arguments,
            workingDirectory: workingDirectory,
            environment: environment,
          )
          .timeout(_spawnTimeout);
      _process!.output.listen((bytes) {
        onOutput?.call(bytes);
        _outputCtrl.add(bytes);
      });
      unawaited(_process!.exitCode.then((c) => _emit(PtyExited(c))));
      _emit(const PtyRunning());
    } on TimeoutException {
      _emit(
        const PtyFailed(
          PtyFailReason.spawnTimeout,
          'Agent did not start in time',
        ),
      );
    } on io.ProcessException catch (e) {
      final reason = e.message.contains('No such file')
          ? PtyFailReason.binaryNotFound
          : PtyFailReason.unknown;
      _emit(PtyFailed(reason, e.message));
    } on Object catch (e) {
      _emit(PtyFailed(PtyFailReason.unknown, e.toString()));
    }
  }

  void write(List<int> bytes) {
    if (_process == null || !isRunning) return;
    _process!.write(bytes);
  }

  void sendPrompt(String prompt) {
    if (_process == null || !isRunning) return;
    final visible = utf8.encode('\r\n[Pickforge sent prompt]\r\n$prompt\r\n');
    onOutput?.call(visible);
    _outputCtrl.add(visible);
    _process!.write('$prompt\r'.codeUnits);
  }

  void resize(int rows, int cols) => _process?.resize(rows: rows, cols: cols);

  Future<void> stop({
    Duration grace = const Duration(milliseconds: 300),
  }) async {
    if (_process == null) return;
    _process!.kill();
    final exited = await _process!.exitCode.timeout(grace, onTimeout: () => -1);
    if (exited == -1) _process!.kill(PtySignal.sigkill);
  }

  Future<void> dispose() async {
    await stop();
    await _stateCtrl.close();
    await _outputCtrl.close();
  }

  void _emit(PtySessionState s) {
    _last = s;
    _stateCtrl.add(s);
  }
}
