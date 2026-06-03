import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/codex_exec_json_adapter.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _FakeRunner implements ProcessRunner {
  _FakeRunner(this.process);

  final RunningProcess process;
  String? executable;
  List<String>? arguments;
  String? cwd;

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    this.executable = executable;
    this.arguments = arguments;
    this.cwd = cwd;
    return process;
  }
}

class _FakeProcess implements RunningProcess {
  _FakeProcess({
    this.stdoutLines = const [],
    this.stderrLines = const [],
    this.code = 0,
    Completer<int>? exitCodeCompleter,
  }) : _exitCodeCompleter = exitCodeCompleter;

  final List<String> stdoutLines;
  final List<String> stderrLines;
  final int code;
  final Completer<int>? _exitCodeCompleter;
  bool killed = false;

  @override
  int get pid => 123;

  @override
  Stream<List<int>> get stdout =>
      Stream.fromIterable(stdoutLines.map(utf8.encode));

  @override
  Stream<List<int>> get stderr =>
      Stream.fromIterable(stderrLines.map(utf8.encode));

  @override
  Future<int> get exitCode => _exitCodeCompleter?.future ?? Future.value(code);

  @override
  void writeStdin(List<int> bytes) {}

  @override
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm}) async {
    killed = true;
  }
}

void main() {
  test('spawns adapter command and records streamed messages', () async {
    final process = _FakeProcess(
      stdoutLines: [
        jsonEncode({
          'type': 'item.completed',
          'item': {'type': 'agent_message', 'text': 'done'},
        }),
      ],
      stderrLines: ['note'],
    );
    final runner = _FakeRunner(process);
    final session = HeadlessChatSession(
      chatId: 'chat-1',
      projectRoot: '/project',
      adapter: const CodexExecJsonAdapter(),
      runner: runner,
    );

    await session.sendPrompt('fix it');

    expect(runner.executable, 'codex');
    expect(runner.cwd, '/project');
    expect(runner.arguments, containsAll(['exec', '--json', 'fix it']));
    expect(session.history.first.role, ChatMessageRole.user);
    expect(session.history.first.text, 'fix it');
    expect(
      session.history.any(
        (message) =>
            message.role == ChatMessageRole.assistant && message.text == 'done',
      ),
      isTrue,
    );
    expect(
      session.history.any(
        (message) =>
            message.role == ChatMessageRole.system && message.text == 'note',
      ),
      isTrue,
    );
  });

  test('emits exit error for non-zero process status', () async {
    final runner = _FakeRunner(_FakeProcess(code: 2));
    final session = HeadlessChatSession(
      chatId: 'chat-1',
      projectRoot: '/project',
      adapter: const CodexExecJsonAdapter(),
      runner: runner,
    );

    await session.sendPrompt('fix it');

    expect(session.history.last.role, ChatMessageRole.error);
    expect(session.history.last.text, 'codex exited with code 2.');
  });

  test('kills the running process on dispose', () async {
    final exit = Completer<int>();
    final process = _FakeProcess(exitCodeCompleter: exit);
    final session = HeadlessChatSession(
      chatId: 'chat-1',
      projectRoot: '/project',
      adapter: const CodexExecJsonAdapter(),
      runner: _FakeRunner(process),
    );

    final send = session.sendPrompt('fix it');
    await Future<void>.delayed(Duration.zero);
    await session.dispose();
    exit.complete(0);
    await send;

    expect(process.killed, isTrue);
  });
}
