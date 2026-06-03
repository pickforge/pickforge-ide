import 'dart:async';

import 'package:pickforge/core/agent/headless/headless_chat_feature_flags.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session_pool.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';

class ChatPromptDispatcher {
  ChatPromptDispatcher(this._ptyPool, this._headlessPool, this._flags);

  final PtySessionPool _ptyPool;
  final HeadlessChatSessionPool _headlessPool;
  final HeadlessChatFeatureFlags _flags;

  void sendPrompt({
    required AgentProfileId agentId,
    required String chatId,
    required String projectRoot,
    required String prompt,
    String? resumeSessionId,
  }) {
    if (_flags.enabled(agentId) && _headlessPool.supports(agentId)) {
      unawaited(
        _headlessPool.sendPrompt(
          chatId: chatId,
          projectRoot: projectRoot,
          agentId: agentId,
          prompt: prompt,
          resumeSessionId: resumeSessionId,
        ),
      );
      return;
    }
    _ptyPool.sendPrompt(chatId, prompt);
  }
}
