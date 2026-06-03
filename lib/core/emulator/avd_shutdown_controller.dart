import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class AvdShutdownException implements Exception {
  const AvdShutdownException(this.serial, this.stderr);

  final String serial;
  final String stderr;

  @override
  String toString() {
    final details = stderr.trim();
    if (details.isEmpty) return 'Failed to shut down $serial';
    return 'Failed to shut down $serial: $details';
  }
}

@lazySingleton
class AvdShutdownController {
  AvdShutdownController(this._runner);

  final ProcessRunner _runner;

  Future<void> shutdown(String serial) async {
    final result = await _runner.run('adb', ['-s', serial, 'emu', 'kill']);
    if (result.exitCode != 0) {
      throw AvdShutdownException(serial, result.stderr.toString());
    }
  }
}
