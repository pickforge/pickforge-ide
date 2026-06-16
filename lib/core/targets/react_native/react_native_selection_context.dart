import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/targets/react_native/react_native_source_candidate_finder.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';
import 'package:pickforge/core/targets/target_selection.dart';

/// A slice of run logs attached to a selection (Metro or logcat).
class ReactNativeLogExcerpt extends Equatable {
  const ReactNativeLogExcerpt({required this.source, required this.lines});

  final String source;
  final List<String> lines;

  Map<String, Object?> toJson() => {'source': source, 'lines': lines};

  @override
  List<Object?> get props => [source, lines];
}

/// The assembled React Native selection context: a generic [TargetSelection]
/// plus the honest RN-specific detail (selected node, ancestors, likely-source
/// candidates, log excerpts, and a disclaimer that source mapping is inexact).
class ReactNativeSelectionContext extends Equatable {
  const ReactNativeSelectionContext({
    required this.targetSelection,
    required this.selectedNode,
    required this.ancestorHierarchy,
    required this.likelySourceFiles,
    required this.logExcerpts,
    required this.disclaimer,
  });

  final TargetSelection targetSelection;
  final ReactNativeA11yNode selectedNode;
  final List<ReactNativeA11yNode> ancestorHierarchy;
  final List<ReactNativeSourceCandidate> likelySourceFiles;
  final List<ReactNativeLogExcerpt> logExcerpts;
  final String disclaimer;

  Map<String, Object?> toJson() => {
        'targetSelection': {
          'id': targetSelection.id,
          'label': targetSelection.label,
          'sourcePath': targetSelection.sourcePath,
          'sourceLine': targetSelection.sourceLine,
          'screenshotPath': targetSelection.screenshotPath,
          'propertiesJson': targetSelection.propertiesJson,
        },
        'selectedNode': _nodeJson(selectedNode),
        'ancestorHierarchy':
            ancestorHierarchy.map(_nodeSummary).toList(growable: false),
        'likelySourceFiles':
            likelySourceFiles.map((c) => c.toJson()).toList(growable: false),
        'logExcerpts':
            logExcerpts.map((e) => e.toJson()).toList(growable: false),
        'disclaimer': disclaimer,
      };

  @override
  List<Object?> get props => [
        targetSelection,
        selectedNode,
        ancestorHierarchy,
        likelySourceFiles,
        logExcerpts,
        disclaimer,
      ];
}

Map<String, Object?> _nodeJson(ReactNativeA11yNode node) => {
      'nodeId': node.nodeId,
      'role': node.role.name,
      'className': node.className,
      'text': node.text,
      'contentDescription': node.contentDescription,
      'resourceId': node.resourceId,
      'bounds': [
        node.bounds.left,
        node.bounds.top,
        node.bounds.right,
        node.bounds.bottom,
      ],
      'enabled': node.enabled,
      'clickable': node.clickable,
      'selected': node.selected,
    };

Map<String, Object?> _nodeSummary(ReactNativeA11yNode node) => {
      'nodeId': node.nodeId,
      'role': node.role.name,
      'className': node.className,
      'resourceId': node.resourceId,
    };

/// Assembles a [ReactNativeSelectionContext] from a screenshot, a selected
/// UIAutomator node, its ancestors, and run-log excerpts, searching the project
/// for likely source files.
class ReactNativeSelectionContextBuilder {
  const ReactNativeSelectionContextBuilder({
    ReactNativeSourceCandidateFinder sourceFinder =
        const ReactNativeSourceCandidateFinder(),
  }) : _sourceFinder = sourceFinder;

  final ReactNativeSourceCandidateFinder _sourceFinder;

  static const disclaimer =
      'Exact React component source mapping is not available for React '
      'Native. The files below are likely matches found by searching the '
      'project for the selected element testID / resource-id, accessibility '
      'label, and visible text.';

  Future<ReactNativeSelectionContext> build({
    required String projectRoot,
    required ReactNativeA11yNode selectedNode,
    String? screenshotPath,
    List<ReactNativeA11yNode> ancestorHierarchy = const [],
    List<String> metroLogLines = const [],
    List<String> logcatLines = const [],
  }) async {
    final candidates = await _sourceFinder.find(
      projectRoot: projectRoot,
      selectedNode: selectedNode,
    );
    final label = selectedNode.text ??
        selectedNode.contentDescription ??
        selectedNode.className;

    final targetSelection = TargetSelection(
      id: selectedNode.nodeId,
      label: label,
      screenshotPath: screenshotPath,
      propertiesJson: jsonEncode({
        'role': selectedNode.role.name,
        'className': selectedNode.className,
        'resourceId': selectedNode.resourceId,
        'text': selectedNode.text,
        'contentDescription': selectedNode.contentDescription,
        'likelySourceFiles': candidates
            .map(
              (c) => {
                'path': c.path,
                'line': c.line,
                'confidence': c.confidence.name,
              },
            )
            .toList(growable: false),
        'disclaimer': disclaimer,
      }),
    );

    final excerpts = <ReactNativeLogExcerpt>[
      if (metroLogLines.isNotEmpty)
        ReactNativeLogExcerpt(source: 'metro', lines: _tail(metroLogLines)),
      if (logcatLines.isNotEmpty)
        ReactNativeLogExcerpt(source: 'logcat', lines: _tail(logcatLines)),
    ];

    return ReactNativeSelectionContext(
      targetSelection: targetSelection,
      selectedNode: selectedNode,
      ancestorHierarchy: ancestorHierarchy,
      likelySourceFiles: candidates,
      logExcerpts: excerpts,
      disclaimer: disclaimer,
    );
  }

  List<String> _tail(List<String> lines, [int max = 20]) =>
      lines.length <= max ? lines : lines.sublist(lines.length - max);
}
