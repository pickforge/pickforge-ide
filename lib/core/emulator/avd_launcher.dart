import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
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

  Future<AvdLaunchHandle> launch(
    String avdId, {
    EmulatorLaunchOptions options = const EmulatorLaunchOptions(),
  }) async {
    final RunningProcess proc;
    if (options.isDefault) {
      proc = await _runner.spawn('flutter', ['emulators', '--launch', avdId]);
    } else {
      proc = await _runner.spawn(
        _emulatorCommand(),
        ['-avd', avdId, ...options.toEmulatorArgs()],
      );
    }
    return AvdLaunchHandle(proc);
  }

  String _emulatorCommand() {
    for (final sdkRoot in _androidSdkRoots()) {
      final executable = p.join(
        sdkRoot,
        'emulator',
        Platform.isWindows ? 'emulator.exe' : 'emulator',
      );
      if (File(executable).existsSync()) return executable;
    }
    return 'emulator';
  }

  Iterable<String> _androidSdkRoots() sync* {
    final seen = <String>{};
    for (final key in ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      final value = Platform.environment[key];
      if (value != null && value.isNotEmpty && seen.add(value)) {
        yield value;
      }
    }
    final home =
        Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'];
    if (home != null && home.isNotEmpty) {
      final defaultRoot = p.join(home, 'Android', 'Sdk');
      if (seen.add(defaultRoot)) yield defaultRoot;
    }
  }
}
