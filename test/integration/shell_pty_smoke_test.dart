import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/process/user_shell_environment.dart';
import 'package:pickforge/core/terminal/flutter_pty_adapter.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';
import 'package:pickforge/core/terminal/shell_invocation.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final smokeEnabled = Platform.environment['PICKFORGE_AGENT_PTY_SMOKE'] == '1';

  test(
    'resolved shell launches over PTY and echoes a round-trip token',
    () async {
      final outDir = Directory(
        Platform.environment['PICKFORGE_AGENT_PTY_SMOKE_OUT_DIR'] ??
            'build/dogfood/shell-pty',
      );
      await outDir.create(recursive: true);
      final project =
          await Directory.systemTemp.createTemp('pickforge-shell-smoke-');
      final logPath = p.join(outDir.path, 'shell.log');
      final log = File(logPath);
      await log.writeAsString('');

      final shell = ShellInvocationResolver().resolve();
      final env = await UserShellEnvironment.instance.load();
      final transcript = StringBuffer();
      final sink = log.openWrite(mode: FileMode.append);
      final session = PtySession(
        chatId: 'smoke-shell',
        executable: shell.executable,
        arguments: shell.arguments,
        workingDirectory: project.path,
        factory: FlutterPtyAdapter(),
        environment: env,
        onOutput: (bytes) {
          final text = const Utf8Decoder(allowMalformed: true).convert(bytes);
          transcript.write(text);
          sink.write(text);
        },
        spawnTimeout: const Duration(seconds: 15),
      );

      try {
        await session.start();
        expect(
          session.currentState,
          isA<PtyRunning>(),
          reason: 'shell ${shell.executable} did not reach running state '
              '(${session.currentState})',
        );

        const token = 'PICKFORGE_SHELL_SMOKE_OK';
        session.write(utf8.encode('echo $token\r'));
        final echoed = await _waitFor(
          // The command echo prints the token once; the output line makes two.
          () => token.allMatches(transcript.toString()).length >= 2,
          timeout: const Duration(seconds: 8),
        );
        expect(echoed, isTrue, reason: 'token not observed in:\n$transcript');

        const pasteToken = 'PICKFORGE_PASTE_TOKEN';
        // Execution output is the token alone on a line; input echoes always
        // carry the `echo ` prefix or escape sequences on the same line.
        // \x07 covers a preceding OSC title terminator (BEL).
        final executedLine = RegExp('[\r\n\x07]$pasteToken[\r\n]');
        session.pasteText('echo $pasteToken');
        await Future<void>.delayed(const Duration(seconds: 2));
        expect(
          transcript.toString(),
          contains(pasteToken),
          reason: 'pasted command was not echoed:\n$transcript',
        );
        expect(
          executedLine.hasMatch(transcript.toString()),
          isFalse,
          reason: 'pasted command must NOT execute before Enter:\n$transcript',
        );
        session.write(utf8.encode('\r'));
        final executed = await _waitFor(
          () => executedLine.hasMatch(transcript.toString()),
          timeout: const Duration(seconds: 8),
        );
        expect(
          executed,
          isTrue,
          reason: 'pasted command did not run after Enter:\n$transcript',
        );

        session.write(utf8.encode('pwd\r'));
        final inProject = await _waitFor(
          () =>
              transcript.toString().contains(project.path) ||
              // Resolve symlinked temp dirs (e.g. /tmp → /private/tmp).
              transcript
                  .toString()
                  .contains(project.resolveSymbolicLinksSync()),
          timeout: const Duration(seconds: 8),
        );
        expect(
          inProject,
          isTrue,
          reason: 'shell cwd is not the project root:\n$transcript',
        );
      } finally {
        await session.dispose();
        await sink.flush();
        await sink.close();
        await project.delete(recursive: true);
      }
    },
    skip: smokeEnabled
        ? false
        : 'Run scripts/agent_profile_pty_smoke.sh to enable this smoke.',
    timeout: const Timeout(Duration(minutes: 2)),
  );
}

Future<bool> _waitFor(
  bool Function() predicate, {
  required Duration timeout,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (predicate()) return true;
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  return predicate();
}
