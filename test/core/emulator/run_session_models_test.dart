import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

void main() {
  test('event variants construct and equate', () {
    expect(
      const RunSessionEvent.stage(message: 'Compiling...'),
      const RunSessionEvent.stage(message: 'Compiling...'),
    );
    expect(
      const RunSessionEvent.log(line: 'hi', level: LogLevel.info),
      const RunSessionEvent.log(line: 'hi', level: LogLevel.info),
    );
    expect(
      const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'),
      const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'),
    );
    expect(
      const RunSessionEvent.stopped(exitCode: 0, reason: 'user_stop'),
      const RunSessionEvent.stopped(exitCode: 0, reason: 'user_stop'),
    );
    expect(
      const RunSessionEvent.reloadCompleted(
        success: true,
        fullRestart: false,
        durationMs: 100,
      ),
      const RunSessionEvent.reloadCompleted(
        success: true,
        fullRestart: false,
        durationMs: 100,
      ),
    );
  });
}
