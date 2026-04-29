import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

sealed class BootReadinessEvent {
  const BootReadinessEvent();
}

class BootPending extends BootReadinessEvent {
  const BootPending(this.elapsed);

  final Duration elapsed;
}

class BootReady extends BootReadinessEvent {
  const BootReady(this.serial);

  final String serial;
}

class BootTimeout extends BootReadinessEvent {
  const BootTimeout();
}

class BootCancelled extends BootReadinessEvent {
  const BootCancelled();
}

class BootError extends BootReadinessEvent {
  const BootError(this.message);

  final String message;
}

@lazySingleton
class BootReadinessPoller {
  BootReadinessPoller(this._runner);

  final ProcessRunner _runner;

  Stream<BootReadinessEvent> poll({
    required String avdId,
    Duration timeout = const Duration(seconds: 60),
    Duration interval = const Duration(milliseconds: 500),
    CancelToken? cancel,
  }) async* {
    final start = DateTime.now();
    while (true) {
      if (cancel?.isCancelled ?? false) {
        yield const BootCancelled();
        return;
      }

      final elapsed = DateTime.now().difference(start);
      if (elapsed >= timeout) {
        yield const BootTimeout();
        return;
      }

      final serial = await _findReadySerialFor(avdId);
      if (serial != null) {
        yield BootReady(serial);
        return;
      }

      yield BootPending(elapsed);
      await Future<void>.delayed(interval);
    }
  }

  Future<String?> _findReadySerialFor(String avdId) async {
    try {
      final list = await _runner.run('adb', ['devices', '-l']);
      if (list.exitCode != 0) return null;
      final serials = list.stdout
          .toString()
          .split('\n')
          .map((line) => line.trim())
          .where((line) => line.startsWith('emulator-'))
          .map((line) => line.split(RegExp(r'\s+')).first)
          .toList();

      for (final serial in serials) {
        final boot = await _runner.run(
          'adb',
          ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
        );
        if (boot.exitCode != 0 || boot.stdout.toString().trim() != '1') {
          continue;
        }

        final name =
            await _runner.run('adb', ['-s', serial, 'emu', 'avd', 'name']);
        if (name.exitCode != 0) continue;
        final avdName = name.stdout
            .toString()
            .split('\n')
            .map((line) => line.trim())
            .firstWhere(
              (line) => line.isNotEmpty && line != 'OK',
              orElse: () => '',
            );
        if (avdName != avdId) continue;

        final pm = await _runner.run(
          'adb',
          ['-s', serial, 'shell', 'pm', 'path', 'android'],
        );
        if (pm.exitCode != 0) continue;
        return serial;
      }
      return null;
    } on ProcessRunnerException {
      return null;
    }
  }
}
