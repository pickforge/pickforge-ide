import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class AvdLaunchHandle {
  AvdLaunchHandle(this._proc);

  final RunningProcess _proc;

  int get pid => _proc.pid;

  Future<void> cancel() => _proc.kill();
}

@lazySingleton
class AvdLauncher {
  AvdLauncher(this._runner);

  final ProcessRunner _runner;

  Future<AvdLaunchHandle> launch(String avdId) async {
    final proc =
        await _runner.spawn('flutter', ['emulators', '--launch', avdId]);
    return AvdLaunchHandle(proc);
  }
}
