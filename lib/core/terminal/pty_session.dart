import 'dart:async';
import 'dart:convert';
import 'dart:io' as io;

import 'package:logging/logging.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';

final _log = Logger('pty.session');

class PtySession {
  PtySession({
    required this.chatId,
    required this.executable,
    required this.arguments,
    required this.workingDirectory,
    required PtyProcessFactory factory,
    this.environment,
    this.onOutput,
    this.onDispose,
    Duration spawnTimeout = const Duration(seconds: 8),
  })  : _factory = factory,
        _spawnTimeout = spawnTimeout;

  final String chatId;
  final String executable;
  final List<String> arguments;
  final String workingDirectory;
  final Map<String, String>? environment;

  /// Transcript sink. Lives with the session: a pooled session keeps
  /// recording while its pane is unmounted, so reopening the chat replays
  /// everything that happened in the background.
  void Function(List<int> bytes)? onOutput;

  /// Owned-resource teardown (e.g. the transcript recorder), awaited at the
  /// end of [dispose].
  Future<void> Function()? onDispose;
  final PtyProcessFactory _factory;
  final Duration _spawnTimeout;

  final _stateCtrl = StreamController<PtySessionState>.broadcast();
  final _outputCtrl = StreamController<List<int>>.broadcast();
  final _inputCtrl = StreamController<void>.broadcast();
  PtyProcess? _process;
  PtySessionState _last = const PtyParked();

  Stream<PtySessionState> get state => Stream<PtySessionState>.multi((sub) {
        sub.add(_last);
        final s = _stateCtrl.stream.listen(sub.add);
        sub.onCancel = s.cancel;
      });

  Stream<List<int>> get output => _outputCtrl.stream;

  /// Fires whenever the user (or a quick-launch chip / paste) writes to the
  /// session — the signal that work was actually requested here.
  Stream<void> get input => _inputCtrl.stream;

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
      unawaited(
        _process!.exitCode.then((c) {
          _log.info('[$chatId] $executable exited with code $c');
          _emit(PtyExited(c));
        }),
      );
      _log.info('[$chatId] spawned $executable (cwd: $workingDirectory)');
      _emit(const PtyRunning());
    } on TimeoutException {
      _log.warning('[$chatId] $executable did not start in time');
      _emit(
        const PtyFailed(
          PtyFailReason.spawnTimeout,
          'Process did not start in time',
        ),
      );
    } on io.ProcessException catch (e) {
      final reason = e.message.contains('No such file')
          ? PtyFailReason.binaryNotFound
          : PtyFailReason.unknown;
      _log.warning('[$chatId] $executable failed to spawn: ${e.message}');
      _emit(PtyFailed(reason, e.message));
    } on Object catch (e) {
      _log.warning('[$chatId] $executable failed to spawn: $e');
      _emit(PtyFailed(PtyFailReason.unknown, e.toString()));
    }
  }

  void write(List<int> bytes) {
    if (_process == null || !isRunning) return;
    if (!_inputCtrl.isClosed) _inputCtrl.add(null);
    _process!.write(bytes);
  }

  /// Types [text] as if the user had typed it: raw bytes, no submission.
  void typeText(String text) => write(utf8.encode(text));

  /// Pastes [text] without submitting it. Bracketed paste keeps multi-line
  /// content from executing line-by-line in shells and lands whole in TUI
  /// composers; the end-bracket sequence is stripped from the payload so
  /// pasted content cannot escape the bracket and inject keystrokes.
  void pasteText(String text, {bool bracketed = true}) {
    final sanitized = text
        .replaceAll('\r\n', '\n')
        .replaceAll('\x1b[200~', '')
        .replaceAll('\x1b[201~', '');
    write(
      utf8.encode(
        bracketed ? '\x1b[200~$sanitized\x1b[201~' : sanitized,
      ),
    );
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
    await _inputCtrl.close();
    await onDispose?.call();
  }

  void _emit(PtySessionState s) {
    _last = s;
    // The process exit callback can fire after dispose() closed the
    // controller (e.g. a shell killed during teardown).
    if (!_stateCtrl.isClosed) _stateCtrl.add(s);
  }
}
