import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/android/android_uiautomator_node.dart';
import 'package:pickforge/core/targets/native_android/native_android_source_candidate_finder.dart';
import 'package:pickforge/core/targets/target_selection.dart';

/// The assembled native Android selection context: a generic [TargetSelection]
/// plus the honest Android-specific detail (selected node, ancestors, likely
/// source candidates, a logcat excerpt, and a disclaimer that View/Compose
/// source mapping is inexact).
class NativeAndroidSelectionContext extends Equatable {
  const NativeAndroidSelectionContext({
    required this.targetSelection,
    required this.selectedNode,
    required this.ancestorHierarchy,
    required this.likelySourceFiles,
    required this.logcatExcerpt,
    required this.disclaimer,
  });

  final TargetSelection targetSelection;
  final AndroidA11yNode selectedNode;
  final List<AndroidA11yNode> ancestorHierarchy;
  final List<NativeAndroidSourceCandidate> likelySourceFiles;
  final List<String> logcatExcerpt;
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
        'logcatExcerpt': logcatExcerpt,
        'disclaimer': disclaimer,
      };

  @override
  List<Object?> get props => [
        targetSelection,
        selectedNode,
        ancestorHierarchy,
        likelySourceFiles,
        logcatExcerpt,
        disclaimer,
      ];
}

Map<String, Object?> _nodeJson(AndroidA11yNode node) => {
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

Map<String, Object?> _nodeSummary(AndroidA11yNode node) => {
      'nodeId': node.nodeId,
      'role': node.role.name,
      'className': node.className,
      'resourceId': node.resourceId,
    };

/// Assembles a [NativeAndroidSelectionContext], searching the project for the
/// likely source files. `TargetSelection.sourcePath` stays null — only
/// best-effort hints, never an exact View/Compose mapping.
class NativeAndroidSelectionContextBuilder {
  const NativeAndroidSelectionContextBuilder({
    NativeAndroidSourceCandidateFinder sourceFinder =
        const NativeAndroidSourceCandidateFinder(),
  }) : _sourceFinder = sourceFinder;

  final NativeAndroidSourceCandidateFinder _sourceFinder;

  static const disclaimer =
      'Exact Android View / Jetpack Compose source mapping is not available. '
      'The files below are likely matches found by searching the project for '
      'the selected element resource-id / testTag, content description, and '
      'visible text.';

  Future<NativeAndroidSelectionContext> build({
    required String projectRoot,
    required AndroidA11yNode selectedNode,
    String? screenshotPath,
    List<AndroidA11yNode> ancestorHierarchy = const [],
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

    return NativeAndroidSelectionContext(
      targetSelection: targetSelection,
      selectedNode: selectedNode,
      ancestorHierarchy: ancestorHierarchy,
      likelySourceFiles: candidates,
      logcatExcerpt: logcatLines.length <= 20
          ? logcatLines
          : logcatLines.sublist(logcatLines.length - 20),
      disclaimer: disclaimer,
    );
  }
}
