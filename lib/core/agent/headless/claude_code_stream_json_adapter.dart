import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/event_text_extractor.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter.dart';
import 'package:pickforge/core/agent/models.dart';

class ClaudeCodeStreamJsonAdapter extends HeadlessChatAdapter {
  const ClaudeCodeStreamJsonAdapter();

  @override
  AgentProfileId get agentId => AgentProfileId.claudeCode;

  @override
  String get executable => 'claude';

  @override
  List<String> argumentsForPrompt(
    String prompt, {
    String? resumeSessionId,
  }) {
    return [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      if (resumeSessionId != null) ...['--resume', resumeSessionId],
    ];
  }

  @override
  ChatMessage? parseJsonEvent(Map<String, Object?> event) {
    final type = eventString(event, 'type');
    switch (type) {
      case 'assistant':
        return _message(ChatMessageRole.assistant, eventText(event['message']));
      case 'result':
        final text = eventTextFromFields(event, ['result', 'message', 'text']);
        return _message(ChatMessageRole.assistant, text);
      case 'system':
        return _message(ChatMessageRole.system, eventText(event));
      case 'stream_event':
        final raw = eventMap(event['event']);
        final rawType = eventString(raw, 'type');
        if (rawType == 'content_block_delta' ||
            rawType == 'message_delta' ||
            rawType == 'text_delta') {
          return _message(
            ChatMessageRole.assistant,
            eventTextFromFields(raw ?? const {}, ['delta', 'text']),
          );
        }
        if (rawType?.contains('error') == true) {
          return _message(ChatMessageRole.error, eventText(raw));
        }
    }

    final role = eventRole(event);
    final text = eventText(event);
    return switch (role) {
      'assistant' => _message(ChatMessageRole.assistant, text),
      'user' => _message(ChatMessageRole.user, text),
      'system' => _message(ChatMessageRole.system, text),
      _ => null,
    };
  }

  ChatMessage? _message(ChatMessageRole role, String? text) =>
      text == null ? null : ChatMessage(role: role, text: text);
}
