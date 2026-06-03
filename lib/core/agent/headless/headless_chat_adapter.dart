import 'dart:convert';

import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/models.dart';

abstract class HeadlessChatAdapter {
  const HeadlessChatAdapter();

  AgentProfileId get agentId;
  String get executable;

  List<String> argumentsForPrompt(
    String prompt, {
    String? resumeSessionId,
  });

  ChatMessage? parseJsonEvent(Map<String, Object?> event);

  ChatMessage? parseJsonLine(String line) {
    final trimmed = line.trim();
    if (trimmed.isEmpty) return null;

    try {
      final decoded = jsonDecode(trimmed);
      if (decoded is! Map) {
        return ChatMessage(role: ChatMessageRole.system, text: trimmed);
      }
      return parseJsonEvent(decoded.cast<String, Object?>());
    } on FormatException {
      return ChatMessage(role: ChatMessageRole.system, text: trimmed);
    }
  }
}
