import 'package:pickforge/core/agent/headless/headless_chat_adapter_registry.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class HeadlessChatSessionPool {
  HeadlessChatSessionPool(this._runner, this._registry);

  final ProcessRunner _runner;
  final HeadlessChatAdapterRegistry _registry;
  final _sessions = <String, HeadlessChatSession>{};

  HeadlessChatSession? session(String chatId) => _sessions[chatId];

  bool supports(AgentProfileId agentId) => _registry.supports(agentId);

  Future<HeadlessChatSession> activate({
    required String chatId,
    required String projectRoot,
    required AgentProfileId agentId,
    String? resumeSessionId,
  }) async {
    final existing = _sessions[chatId];
    if (existing != null) return existing;
    final session = HeadlessChatSession(
      chatId: chatId,
      projectRoot: projectRoot,
      adapter: _registry.get(agentId),
      runner: _runner,
      resumeSessionId: resumeSessionId,
    );
    _sessions[chatId] = session;
    return session;
  }

  Future<void> sendPrompt({
    required String chatId,
    required String projectRoot,
    required AgentProfileId agentId,
    required String prompt,
    String? resumeSessionId,
  }) async {
    final session = await activate(
      chatId: chatId,
      projectRoot: projectRoot,
      agentId: agentId,
      resumeSessionId: resumeSessionId,
    );
    await session.sendPrompt(prompt);
  }

  Future<void> detach(String chatId) async {
    final session = _sessions.remove(chatId);
    await session?.dispose();
  }

  Future<void> parkAll() async {
    final all = List<HeadlessChatSession>.from(_sessions.values);
    _sessions.clear();
    await Future.wait(all.map((session) => session.dispose()));
  }
}
