import 'package:pickforge/core/inspector/models.dart';

class WidgetTreeDecoder {
  const WidgetTreeDecoder._();

  static WidgetNode decode(Map<String, dynamic> raw) {
    final children = (raw['children'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(decode)
        .toList(growable: false);
    final locRaw = raw['creationLocation'] as Map<String, dynamic>?;
    return WidgetNode(
      id: raw['valueId'] as String,
      className: raw['description'] as String? ?? '<unknown>',
      children: children,
      creationLocation: locRaw == null
          ? null
          : CreationLocation(
              file: locRaw['file'] as String,
              line: locRaw['line'] as int,
              column: locRaw['column'] as int,
            ),
    );
  }
}
