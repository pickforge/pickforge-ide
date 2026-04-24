import 'package:pickforge/core/inspector/models.dart';

/// Renders a [SelectedWidget] into a markdown string for agent context.
///
/// Pure utility — no DI, no side effects.
class WidgetContextRenderer {
  const WidgetContextRenderer();

  /// Renders [sel] as a markdown string with widget name, creation location,
  /// ancestor chain, and source snippet.
  String render(SelectedWidget sel) {
    final buf = StringBuffer()
      ..writeln('# Widget Context')
      ..writeln()
      ..writeln('## Widget')
      ..writeln('- **Class:** `${sel.node.className}`')
      ..writeln('- **ID:** `${sel.node.id}`')
      ..writeln();

    final loc = sel.node.creationLocation;
    if (loc != null) {
      buf
        ..writeln('## Creation Location')
        ..writeln('- **File:** `${loc.file}`')
        ..writeln('- **Line:** ${loc.line}')
        ..writeln('- **Column:** ${loc.column}')
        ..writeln();
    }

    if (sel.ancestorClasses.isNotEmpty) {
      buf.writeln('## Ancestor Chain');
      for (final ancestor in sel.ancestorClasses) {
        buf.writeln('- `$ancestor`');
      }
      buf.writeln();
    }

    final snippet = sel.sourceSnippet;
    if (snippet != null && snippet.isNotEmpty) {
      buf
        ..writeln('## Source Snippet')
        ..writeln('```dart')
        ..writeln(snippet)
        ..writeln('```')
        ..writeln();
    }

    return buf.toString();
  }
}
