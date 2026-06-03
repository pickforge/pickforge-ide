import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/event_text_extractor.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter.dart';
import 'package:pickforge/core/agent/models.dart';

class OpenCodeRunJsonAdapter extends HeadlessChatAdapter {
  const OpenCodeRunJsonAdapter();

  @override
  AgentProfileId get agentId => AgentProfileId.opencode;

  @override
  String get executable => 'opencode';

  @override
  List<String> argumentsForPrompt(
    String prompt, {
    String? resumeSessionId,
  }) {
    return ['run', '--format', 'json', prompt];
  }

  @override
  ChatMessage? parseJsonEvent(Map<String, Object?> event) {
    final type = eventString(event, 'type')?.toLowerCase();
    final role = eventRole(event)?.toLowerCase();
    final text = eventText(event);

    if (type?.contains('error') == true || role == 'error') {
      return _message(ChatMessageRole.error, text ?? type);
    }
    return switch (role) {
      'assistant' => _message(ChatMessageRole.assistant, text),
      'user' => _message(ChatMessageRole.user, text),
      'system' => _message(ChatMessageRole.system, text),
      _ when type == 'assistant' || type == 'message' =>
        _message(ChatMessageRole.assistant, text),
      _ when type == 'system' || type == 'status' =>
        _message(ChatMessageRole.system, text),
      _ => null,
    };
  }

  ChatMessage? _message(ChatMessageRole role, String? text) =>
      text == null ? null : ChatMessage(role: role, text: text);
}
