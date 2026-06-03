import 'dart:async';
import 'dart:convert';

import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class HeadlessChatSession {
  HeadlessChatSession({
    required this.chatId,
    required this.projectRoot,
    required this.adapter,
    required ProcessRunner runner,
    this.resumeSessionId,
  }) : _runner = runner;

  final String chatId;
  final String projectRoot;
  final String? resumeSessionId;
  final HeadlessChatAdapter adapter;
  final ProcessRunner _runner;
  final _controller = StreamController<ChatMessage>.broadcast();
  final _history = <ChatMessage>[];
  RunningProcess? _process;
  Future<void>? _inFlight;
  bool _disposed = false;

  Stream<ChatMessage> get messages => _controller.stream;
  List<ChatMessage> get history => List.unmodifiable(_history);
  bool get isRunning => _inFlight != null;

  Future<void> sendPrompt(String prompt) {
    final trimmed = prompt.trim();
    if (trimmed.isEmpty) return Future.value();
    if (_inFlight != null) {
      _emit(
        ChatMessage(
          role: ChatMessageRole.system,
          text: 'Headless adapter is still running.',
        ),
      );
      return Future.value();
    }

    final task = _run(trimmed);
    _inFlight = task;
    return task.whenComplete(() {
      if (identical(_inFlight, task)) _inFlight = null;
    });
  }

  Future<void> dispose() async {
    _disposed = true;
    final process = _process;
    _process = null;
    if (process != null) await process.kill();
    await _controller.close();
  }

  Future<void> _run(String prompt) async {
    _emit(ChatMessage(role: ChatMessageRole.user, text: prompt));

    RunningProcess process;
    try {
      process = await _runner.spawn(
        adapter.executable,
        adapter.argumentsForPrompt(prompt, resumeSessionId: resumeSessionId),
        cwd: projectRoot,
      );
      _process = process;
    } on Object catch (e) {
      _emit(
        ChatMessage(
          role: ChatMessageRole.error,
          text: 'Could not start ${adapter.executable}: $e',
        ),
      );
      return;
    }

    final stdoutDone = process.stdout
        .transform(const Utf8Decoder(allowMalformed: true))
        .transform(const LineSplitter())
        .listen(_handleStdoutLine)
        .asFuture<void>();
    final stderrDone = process.stderr
        .transform(const Utf8Decoder(allowMalformed: true))
        .transform(const LineSplitter())
        .listen(_handleStderrLine)
        .asFuture<void>();

    final exitCode = await process.exitCode;
    await Future.wait([stdoutDone, stderrDone]);
    if (identical(_process, process)) _process = null;
    if (exitCode != 0) {
      _emit(
        ChatMessage(
          role: ChatMessageRole.error,
          text: '${adapter.executable} exited with code $exitCode.',
        ),
      );
    }
  }

  void _handleStdoutLine(String line) {
    final message = adapter.parseJsonLine(line);
    if (message != null) _emit(message);
  }

  void _handleStderrLine(String line) {
    final text = line.trim();
    if (text.isEmpty) return;
    _emit(ChatMessage(role: ChatMessageRole.system, text: text));
  }

  void _emit(ChatMessage message) {
    if (_disposed) return;
    _history.add(message);
    if (!_controller.isClosed) _controller.add(message);
  }
}
