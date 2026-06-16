import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/android/android_logcat_parser.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

LogLevel _level(RunSessionEvent event) => event.maybeMap(
      log: (l) => l.level,
      orElse: () => fail('expected a log event'),
    );

void main() {
  const parser = AndroidLogcatParser();

  test('classifies threadtime priority letters', () {
    expect(
      _level(parser.logcatEvent('06-16 01:23:45.678 1234 5678 E Tag: boom')!),
      LogLevel.error,
    );
    expect(
      _level(parser.logcatEvent('06-16 01:23:45.678 1234 5678 W Tag: slow')!),
      LogLevel.warning,
    );
    expect(
      _level(parser.logcatEvent('06-16 01:23:45.678 1234 5678 I Tag: ok')!),
      LogLevel.info,
    );
  });

  test('classifies brief-format priority letters and sets source', () {
    final event = parser.logcatEvent('E/AndroidRuntime( 12): FATAL')!;
    expect(_level(event), LogLevel.error);
    expect(
      event.maybeMap(log: (l) => l.source, orElse: () => null),
      'logcat',
    );
  });

  test('defaults to info and drops blanks', () {
    expect(
      _level(parser.logcatEvent('--------- beginning of main')!),
      LogLevel.info,
    );
    expect(parser.logcatEvent('   '), isNull);
  });
}
