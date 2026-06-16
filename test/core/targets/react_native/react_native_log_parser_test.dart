import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/targets/react_native/react_native_log_parser.dart';

({String line, LogLevel level, String source}) _log(RunSessionEvent event) {
  return event.map(
    stage: (_) => fail('expected a log event'),
    log: (log) => (line: log.line, level: log.level, source: log.source),
    vmServiceReady: (_) => fail('expected a log event'),
    stopped: (_) => fail('expected a log event'),
    reloadCompleted: (_) => fail('expected a log event'),
  );
}

void main() {
  const parser = ReactNativeLogParser();

  test('parses metro lines with levels and drops blanks', () {
    const chunk = 'info Dev server ready\n'
        '\n'
        'BUNDLE ./index.js\n'
        'warn Something is deprecated\n'
        'error Failed to bundle\n';

    final events = parser.parseMetro(chunk).map(_log).toList();

    expect(events, hasLength(4));
    expect(events.every((e) => e.source == 'metro'), isTrue);
    expect(events[0].level, LogLevel.info);
    expect(events[1].level, LogLevel.info);
    expect(events[2].level, LogLevel.warning);
    expect(events[3].level, LogLevel.error);
    expect(events[3].line, 'error Failed to bundle');
  });

  test('classifies fatal and inline error: as errors', () {
    expect(_log(parser.metroEvent('fatal boom')!).level, LogLevel.error);
    expect(
      _log(parser.metroEvent('TransformError error: bad syntax')!).level,
      LogLevel.error,
    );
  });

  test('metroEvent returns null for blank lines', () {
    expect(parser.metroEvent('   '), isNull);
    expect(parser.metroEvent(''), isNull);
  });

  group('logcat', () {
    test('classifies threadtime priority letters', () {
      ({String line, LogLevel level, String source}) parse(String l) =>
          _log(parser.logcatEvent(l)!);

      expect(
        parse('06-16 01:23:45.678  1234  5678 E ReactNativeJS: crashed').level,
        LogLevel.error,
      );
      expect(
        parse('06-16 01:23:45.678  1234  5678 F libc: fatal signal').level,
        LogLevel.error,
      );
      expect(
        parse('06-16 01:23:45.678  1234  5678 W ActivityManager: slow').level,
        LogLevel.warning,
      );
      expect(
        parse('06-16 01:23:45.678  1234  5678 I ReactNative: ready').level,
        LogLevel.info,
      );
      final event = parse('06-16 01:23:45.678  1234  5678 I Tag: hi');
      expect(event.source, 'logcat');
    });

    test('classifies brief-format priority letters', () {
      expect(
        _log(parser.logcatEvent('E/AndroidRuntime( 1234): FATAL')!).level,
        LogLevel.error,
      );
      expect(
        _log(parser.logcatEvent('W/Choreographer( 1234): skipped')!).level,
        LogLevel.warning,
      );
    });

    test('defaults to info and drops blanks', () {
      expect(
        _log(parser.logcatEvent('--------- beginning of main')!).level,
        LogLevel.info,
      );
      expect(parser.logcatEvent('   '), isNull);
    });
  });
}
