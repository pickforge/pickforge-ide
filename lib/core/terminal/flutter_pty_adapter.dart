import 'dart:async';
import 'dart:io' as io;
import 'dart:typed_data';

import 'package:flutter_pty/flutter_pty.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/process/user_shell_environment.dart';
import 'package:pickforge/core/terminal/pty_environment.dart';
import 'package:pickforge/core/terminal/pty_process.dart';

class _FlutterPtyProcess implements PtyProcess {
  _FlutterPtyProcess(this._pty);

  final Pty _pty;

  @override
  Stream<List<int>> get output => _pty.output;

  @override
  Future<int> get exitCode => _pty.exitCode;

  @override
  void write(List<int> bytes) => _pty.write(Uint8List.fromList(bytes));

  @override
  void resize({required int rows, required int cols}) =>
      _pty.resize(rows, cols);

  @override
  void kill([PtySignal signal = PtySignal.sigterm]) {
    _pty.kill(_mapSignal(signal));
  }

  io.ProcessSignal _mapSignal(PtySignal s) => switch (s) {
        PtySignal.sigint => io.ProcessSignal.sigint,
        PtySignal.sigterm => io.ProcessSignal.sigterm,
        PtySignal.sigkill => io.ProcessSignal.sigkill,
      };
}

@LazySingleton(as: PtyProcessFactory)
class FlutterPtyAdapter implements PtyProcessFactory {
  @override
  Future<PtyProcess> start({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    Map<String, String>? environment,
    int rows = 30,
    int cols = 100,
  }) async {
    final resolvedEnvironment =
        environment ?? await UserShellEnvironment.instance.load();
    final pty = Pty.start(
      executable,
      arguments: arguments,
      workingDirectory: workingDirectory,
      environment: normalizePtyEnvironment(resolvedEnvironment),
      rows: rows,
      columns: cols,
    );
    return _FlutterPtyProcess(pty);
  }
}
