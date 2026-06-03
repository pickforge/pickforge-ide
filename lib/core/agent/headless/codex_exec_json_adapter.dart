import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/event_text_extractor.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter.dart';
import 'package:pickforge/core/agent/models.dart';

class CodexExecJsonAdapter extends HeadlessChatAdapter {
  const CodexExecJsonAdapter();

  @override
  AgentProfileId get agentId => AgentProfileId.codex;

  @override
  String get executable => 'codex';

  @override
  List<String> argumentsForPrompt(
    String prompt, {
    String? resumeSessionId,
  }) {
    return [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'never',
      prompt,
    ];
  }

  @override
  ChatMessage? parseJsonEvent(Map<String, Object?> event) {
    final type = eventString(event, 'type');
    if (type == 'item.completed') {
      final item = eventMap(event['item']);
      final itemType = eventString(item, 'type');
      final text = eventText(item);
      return switch (itemType) {
        'agent_message' => _message(ChatMessageRole.assistant, text),
        'command_execution' => _message(ChatMessageRole.system, text),
        _ => null,
      };
    }
    if (type == 'turn.failed' || type == 'error') {
      final text = eventTextFromFields(event, ['error', 'message', 'text']) ??
          eventText(event);
      return _message(ChatMessageRole.error, text ?? type);
    }
    return null;
  }

  ChatMessage? _message(ChatMessageRole role, String? text) =>
      text == null ? null : ChatMessage(role: role, text: text);
}
