import 'dart:math' as math;

import 'package:pickforge/core/targets/native_android/native_android_selection_context.dart';

/// Renders a [NativeAndroidSelectionContext] as agent-facing markdown, labelled
/// "best-effort support" (not exact source mapping) with the disclaimer always
/// present.
class NativeAndroidContextRenderer {
  const NativeAndroidContextRenderer();

  String render(NativeAndroidSelectionContext context) {
    final node = context.selectedNode;
    final buffer = StringBuffer()
      ..writeln('# Native Android — best-effort support')
      ..writeln()
      ..writeln('## Selected element')
      ..writeln('- Role: ${node.role.name}')
      ..writeln('- Class: ${_inline(node.className)}');
    if (node.text != null) {
      buffer.writeln('- Text: ${_inline(node.text!)}');
    }
    if (node.contentDescription != null) {
      buffer.writeln(
        '- Content description: ${_inline(node.contentDescription!)}',
      );
    }
    if (node.resourceId != null) {
      buffer.writeln('- Resource id / testTag: ${_inline(node.resourceId!)}');
    }
    final screenshot = context.targetSelection.screenshotPath;
    if (screenshot != null) {
      buffer.writeln('- Screenshot: ${_inline(screenshot)}');
    }

    if (context.ancestorHierarchy.isNotEmpty) {
      buffer
        ..writeln()
        ..writeln('## Ancestors (root → parent)');
      for (final ancestor in context.ancestorHierarchy) {
        final id = ancestor.resourceId != null
            ? ' (${_inline(ancestor.resourceId!)})'
            : '';
        buffer.writeln(
          '- ${ancestor.role.name} ${_inline(ancestor.className)}$id',
        );
      }
    }

    buffer
      ..writeln()
      ..writeln('## Likely source files');
    if (context.likelySourceFiles.isEmpty) {
      buffer.writeln('- None found.');
    } else {
      for (final candidate in context.likelySourceFiles) {
        final location = candidate.line != null
            ? '${_inline(candidate.path)}:${candidate.line}'
            : _inline(candidate.path);
        buffer.writeln(
          '- $location — ${candidate.confidence.name} confidence '
          '(${candidate.signal.name}: "${_inline(candidate.matchedValue)}")',
        );
      }
    }

    if (context.logcatExcerpt.isNotEmpty) {
      final fence = _fenceFor(context.logcatExcerpt);
      buffer
        ..writeln()
        ..writeln('## logcat (recent)')
        ..writeln(fence);
      context.logcatExcerpt.forEach(buffer.writeln);
      buffer.writeln(fence);
    }

    buffer
      ..writeln()
      ..writeln('> ${context.disclaimer}');
    return buffer.toString();
  }

  // Collapse CR/LF in an inline value so it can't inject markdown headings,
  // bullets, or fake sections into the agent-facing output.
  String _inline(String value) => value.replaceAll(RegExp(r'[\r\n]+'), ' ');

  String _fenceFor(List<String> lines) {
    var longestRun = 0;
    for (final line in lines) {
      for (final match in RegExp('`+').allMatches(line)) {
        longestRun = math.max(longestRun, match.group(0)!.length);
      }
    }
    return '`' * math.max(3, longestRun + 1);
  }
}
