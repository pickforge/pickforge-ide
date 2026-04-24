import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

void main() {
  group('TerminalDetector', () {
    test('detects binary on PATH using mock ProcessRunner', () async {
      final detector = TerminalDetector(
        processRunner: (executable, arguments) async {
          expect(arguments, ['ghostty']);
          return ProcessResult(0, 0, '', '');
        },
      );

      final result = await detector.isBinaryOnPath('ghostty');
      expect(result, isTrue);
    });

    test('returns false when binary not found', () async {
      final detector = TerminalDetector(
        processRunner: (executable, arguments) async {
          return ProcessResult(1, 1, '', '');
        },
      );

      final result = await detector.isBinaryOnPath('nonexistent-binary-xyz');
      expect(result, isFalse);
    });

    test('returns false when ProcessException thrown', () async {
      final detector = TerminalDetector(
        processRunner: (executable, arguments) async {
          throw const ProcessException('not-found', []);
        },
      );

      final result = await detector.isBinaryOnPath('missing');
      expect(result, isFalse);
    });

    test('uses correct executable per platform', () async {
      String? capturedExecutable;
      final detector = TerminalDetector(
        processRunner: (executable, arguments) async {
          capturedExecutable = executable;
          return ProcessResult(0, 0, '', '');
        },
      );

      await detector.isBinaryOnPath('test-bin');
      // On Linux/macOS it should be 'which', on Windows 'where'
      if (Platform.isWindows) {
        expect(capturedExecutable, 'where');
      } else {
        expect(capturedExecutable, 'which');
      }
    });
  });
}
