import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/headless/chat_prompt_dispatcher.dart';
import 'package:pickforge/core/agent/headless/codex_exec_json_adapter.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter_registry.dart';
import 'package:pickforge/core/agent/headless/headless_chat_feature_flags.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session_pool.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';

class _RecordingPtyPool extends PtySessionPool {
  final prompts = <String, String>{};

  @override
  void paste(String chatId, String text) {
    prompts[chatId] = text;
  }
}

class _RecordingHeadlessPool extends HeadlessChatSessionPool {
  _RecordingHeadlessPool()
      : super(
          _NoopRunner(),
          HeadlessChatAdapterRegistry([const CodexExecJsonAdapter()]),
        );

  final prompts = <String, String>{};

  @override
  Future<void> sendPrompt({
    required String chatId,
    required String projectRoot,
    required AgentProfileId agentId,
    required String prompt,
    String? resumeSessionId,
  }) {
    prompts[chatId] = prompt;
    return Future.value();
  }
}

class _NoopRunner implements ProcessRunner {
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
  }) {
    throw UnimplementedError();
  }
}

void main() {
  test('uses PTY pool while headless flag is disabled', () {
    final ptyPool = _RecordingPtyPool();
    final headlessPool = _RecordingHeadlessPool();
    ChatPromptDispatcher(
      ptyPool,
      headlessPool,
      const HeadlessChatFeatureFlags(),
    ).sendPrompt(
      agentId: AgentProfileId.codex,
      chatId: 'chat-1',
      projectRoot: '/project',
      prompt: 'fix it',
    );

    expect(ptyPool.prompts, {'chat-1': 'fix it'});
    expect(headlessPool.prompts, isEmpty);
  });

  test('uses headless pool when the agent flag is enabled', () {
    final ptyPool = _RecordingPtyPool();
    final headlessPool = _RecordingHeadlessPool();
    ChatPromptDispatcher(
      ptyPool,
      headlessPool,
      const HeadlessChatFeatureFlags(
        enabledByAgent: {AgentProfileId.codex: true},
      ),
    ).sendPrompt(
      agentId: AgentProfileId.codex,
      chatId: 'chat-1',
      projectRoot: '/project',
      prompt: 'fix it',
    );

    expect(ptyPool.prompts, isEmpty);
    expect(headlessPool.prompts, {'chat-1': 'fix it'});
  });
}
