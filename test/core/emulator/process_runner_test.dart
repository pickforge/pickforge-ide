import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

void main() {
  group('RealProcessRunner.run', () {
    test('captures stdout from echo', () async {
      final runner = RealProcessRunner();
      final res = await runner.run('echo', ['hello']);
      expect(res.exitCode, 0);
      expect((res.stdout as String).trim(), 'hello');
    });

    test('throws ProcessRunnerException when exe missing', () async {
      final runner = RealProcessRunner();
      expect(
        () => runner.run('this-binary-definitely-does-not-exist', []),
        throwsA(isA<ProcessRunnerException>()),
      );
    });
  });

  group('RealProcessRunner.spawn', () {
    test('streams stdout lines and reports exit code', () async {
      final runner = RealProcessRunner();
      final proc = await runner.spawn('sh', ['-c', 'echo a; echo b']);
      final out = await proc.stdout.transform(const _Utf8Lines()).toList();
      final code = await proc.exitCode;
      expect(code, 0);
      expect(out.join(), contains('a'));
      expect(out.join(), contains('b'));
    });

    test('kill terminates a long-running spawn', () async {
      final runner = RealProcessRunner();
      final proc = await runner.spawn('sh', ['-c', 'sleep 30']);
      await proc.kill();
      final code = await proc.exitCode;
      expect(code, isNot(0));
    });
  });
}

class _Utf8Lines extends StreamTransformerBase<List<int>, String> {
  const _Utf8Lines();

  @override
  Stream<String> bind(Stream<List<int>> stream) async* {
    final buf = StringBuffer();
    await for (final chunk in stream) {
      buf.write(String.fromCharCodes(chunk));
    }
    yield buf.toString();
  }
}
