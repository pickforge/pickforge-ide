const _textKeys = [
  'text',
  'result',
  'content',
  'message',
  'delta',
  'part',
  'data',
  'error',
  'summary',
  'output',
];

Map<String, Object?>? eventMap(Object? value) =>
    value is Map ? value.cast<String, Object?>() : null;

String? eventString(Map<String, Object?>? event, String key) {
  final value = event?[key];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}

String? eventRole(Map<String, Object?> event) {
  return eventString(event, 'role') ??
      eventString(eventMap(event['message']), 'role') ??
      eventString(eventMap(event['data']), 'role');
}

String? eventText(Object? value) {
  if (value == null) return null;
  if (value is String) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
  if (value is List) {
    final parts = value.map(eventText).whereType<String>().toList();
    return parts.isEmpty ? null : parts.join('\n');
  }
  final map = eventMap(value);
  if (map == null) return null;
  for (final key in _textKeys) {
    if (!map.containsKey(key)) continue;
    final text = eventText(map[key]);
    if (text != null) return text;
  }
  return null;
}

String? eventTextFromFields(
  Map<String, Object?> event,
  List<String> fields,
) {
  for (final field in fields) {
    final text = eventText(event[field]);
    if (text != null) return text;
  }
  return null;
}
