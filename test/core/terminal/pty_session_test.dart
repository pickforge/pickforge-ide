import 'dart:async';
import 'dart:io' show ProcessException;

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';

class _MockFactory extends Mock implements PtyProcessFactory {}

class _MockProcess extends Mock implements PtyProcess {}

void main() {
  late _MockFactory factory;
  late _MockProcess process;
  late StreamController<List<int>> outputCtrl;
  late Completer<int> exitCompleter;

  setUp(() {
    factory = _MockFactory();
    process = _MockProcess();
    outputCtrl = StreamController<List<int>>.broadcast();
    exitCompleter = Completer<int>();
    when(() => process.output).thenAnswer((_) => outputCtrl.stream);
    when(() => process.exitCode).thenAnswer((_) => exitCompleter.future);
    when(
      () => factory.start(
        executable: any(named: 'executable'),
        arguments: any(named: 'arguments'),
        workingDirectory: any(named: 'workingDirectory'),
        environment: any(named: 'environment'),
        rows: any(named: 'rows'),
        cols: any(named: 'cols'),
      ),
    ).thenAnswer((_) async => process);
  });

  tearDown(() => outputCtrl.close());

  test('start transitions spawning -> running and emits output', () async {
    final session = PtySession(
      chatId: 'c1',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );
    final states = <PtySessionState>[];
    session.state.listen(states.add);

    await session.start();
    outputCtrl.add([72, 105]);
    await pumpEventQueue();

    expect(states.any((s) => s is PtyRunning), isTrue);
  });

  test('exit code 0 -> exited(0)', () async {
    final session = PtySession(
      chatId: 'c2',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );
    final states = <PtySessionState>[];
    session.state.listen(states.add);

    await session.start();
    exitCompleter.complete(0);
    await pumpEventQueue();

    expect(states.last, isA<PtyExited>().having((e) => e.code, 'code', 0));
  });

  test('output is mirrored to onOutput callback', () async {
    final seen = <List<int>>[];
    final session = PtySession(
      chatId: 'c4',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
      onOutput: seen.add,
    );

    await session.start();
    outputCtrl.add([111, 107]);
    await pumpEventQueue();

    expect(seen.single, [111, 107]);
  });

  test('typeText writes raw bytes with no carriage return or echo', () async {
    final seenOutput = <List<int>>[];
    final session = PtySession(
      chatId: 'c_type',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
      onOutput: seenOutput.add,
    );

    await session.start();
    session.typeText('claude --model haiku');
    await pumpEventQueue();

    final stdin =
        verify(() => process.write(captureAny())).captured.single as List<int>;
    expect(String.fromCharCodes(stdin), 'claude --model haiku');
    expect(seenOutput, isEmpty);
  });

  test('pasteText wraps in bracketed paste with no trailing return', () async {
    final session = PtySession(
      chatId: 'c_paste',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );

    await session.start();
    session.pasteText('fix the\nselected widget');

    final stdin =
        verify(() => process.write(captureAny())).captured.single as List<int>;
    expect(
      String.fromCharCodes(stdin),
      '\x1b[200~fix the\nselected widget\x1b[201~',
    );
  });

  test('pasteText strips paste-bracket escapes and normalizes CRLF', () async {
    final session = PtySession(
      chatId: 'c_paste2',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );

    await session.start();
    session.pasteText('a\r\nb\x1b[201~; rm -rf /\x1b[200~c');

    final stdin =
        verify(() => process.write(captureAny())).captured.single as List<int>;
    expect(String.fromCharCodes(stdin), '\x1b[200~a\nb; rm -rf /c\x1b[201~');
  });

  test('pasteText without bracketing writes sanitized text only', () async {
    final session = PtySession(
      chatId: 'c_paste3',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );

    await session.start();
    session.pasteText('plain text', bracketed: false);

    final stdin =
        verify(() => process.write(captureAny())).captured.single as List<int>;
    expect(String.fromCharCodes(stdin), 'plain text');
  });

  test('resize forwards rows and columns after start', () async {
    final session = PtySession(
      chatId: 'c5',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );

    await session.start();
    session.resize(40, 120);

    verify(() => process.resize(rows: 40, cols: 120)).called(1);
  });

  test('stop escalates when process ignores graceful termination', () async {
    final session = PtySession(
      chatId: 'c6',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );

    await session.start();
    await session.stop(grace: Duration.zero);

    verify(() => process.kill()).called(1);
    verify(() => process.kill(PtySignal.sigkill)).called(1);
  });

  test('factory throw -> failed(BinaryNotFound)', () async {
    when(
      () => factory.start(
        executable: any(named: 'executable'),
        arguments: any(named: 'arguments'),
        workingDirectory: any(named: 'workingDirectory'),
        environment: any(named: 'environment'),
        rows: any(named: 'rows'),
        cols: any(named: 'cols'),
      ),
    ).thenThrow(const ProcessException('agent', [], 'No such file', 2));

    final session = PtySession(
      chatId: 'c3',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );
    final states = <PtySessionState>[];
    session.state.listen(states.add);

    await session.start();
    await pumpEventQueue();

    expect(
      states.last,
      isA<PtyFailed>().having(
        (f) => f.reason,
        'reason',
        PtyFailReason.binaryNotFound,
      ),
    );
  });
}
