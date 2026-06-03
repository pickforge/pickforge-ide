enum ChatMessageRole { user, assistant, system, error }

class ChatMessage {
  ChatMessage({
    required this.role,
    required this.text,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  final ChatMessageRole role;
  final String text;
  final DateTime timestamp;
}
