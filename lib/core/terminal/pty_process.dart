import 'dart:async';

enum PtySignal { sigint, sigterm, sigkill }

abstract class PtyProcess {
  Stream<List<int>> get output;
  Future<int> get exitCode;
  void write(List<int> bytes);
  void resize({required int rows, required int cols});
  void kill([PtySignal signal = PtySignal.sigterm]);
}

// `start` is the only member today, but a Factory exists to permit future
// methods (e.g. introspection) without churning callers/mocks.
// ignore: one_member_abstracts
abstract class PtyProcessFactory {
  Future<PtyProcess> start({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    Map<String, String>? environment,
    int rows = 30,
    int cols = 100,
  });
}
