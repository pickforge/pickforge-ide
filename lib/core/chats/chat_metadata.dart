import 'dart:convert';

import 'package:pickforge/core/drift/pickforge_database.dart';

enum ChatTaskStatus { active, waiting, done, archived }

extension ChatTaskStatusStorage on ChatTaskStatus {
  String get displayName => switch (this) {
        ChatTaskStatus.active => 'Active',
        ChatTaskStatus.waiting => 'Waiting',
        ChatTaskStatus.done => 'Done',
        ChatTaskStatus.archived => 'Archived',
      };
}

ChatTaskStatus chatTaskStatusFromStorage(String? value) {
  for (final status in ChatTaskStatus.values) {
    if (status.name == value) {
      return status;
    }
  }
  return ChatTaskStatus.active;
}

extension ChatMetadata on ChatRow {
  ChatTaskStatus get taskStatus => chatTaskStatusFromStorage(status);

  List<String> get taskLabels => decodeChatLabels(labelsJson);

  String? get taskBrief {
    final value = taskBriefText?.trim();
    return value == null || value.isEmpty ? null : value;
  }
}

String? normalizeTaskBrief(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

List<String> normalizeChatLabels(Iterable<String> labels) {
  final normalized = <String>{};
  for (final label in labels) {
    final trimmed = label.trim();
    if (trimmed.isNotEmpty) normalized.add(trimmed);
  }
  return normalized.toList(growable: false);
}

List<String> parseChatLabelInput(String value) {
  return normalizeChatLabels(value.split(','));
}

String encodeChatLabels(Iterable<String> labels) {
  return jsonEncode(normalizeChatLabels(labels));
}

List<String> decodeChatLabels(String? raw) {
  if (raw == null || raw.trim().isEmpty) return const [];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const [];
    return normalizeChatLabels(decoded.whereType<String>());
  } on Object {
    return const [];
  }
}
