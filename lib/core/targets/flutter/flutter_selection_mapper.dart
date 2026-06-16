import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/inspector/models/selected_widget.dart';
import 'package:pickforge/core/targets/target_selection.dart';

/// A Flutter pick projected onto the generic target surface.
///
/// [targetSelection] is the deliberately lossy generic view (one screenshot
/// slot, properties as a JSON string); [flutterSelection] retains the full
/// Flutter pick so no inspector precision is lost.
class FlutterSelectionContext extends Equatable {
  const FlutterSelectionContext({
    required this.targetSelection,
    required this.flutterSelection,
  });

  final TargetSelection targetSelection;
  final SelectedWidget flutterSelection;

  Map<String, Object?> toJson() => {
        'targetSelection': {
          'id': targetSelection.id,
          'label': targetSelection.label,
          'sourcePath': targetSelection.sourcePath,
          'sourceLine': targetSelection.sourceLine,
          'propertiesJson': targetSelection.propertiesJson,
          'screenshotPath': targetSelection.screenshotPath,
        },
        'flutter': flutterSelection.toJson(),
      };

  @override
  List<Object?> get props => [targetSelection, flutterSelection];
}

/// Maps the Flutter inspector's [SelectedWidget] onto the generic
/// [TargetSelection], keeping the original pick alongside for full fidelity.
class FlutterSelectionMapper {
  const FlutterSelectionMapper();

  FlutterSelectionContext map(SelectedWidget selected) {
    final location = selected.node.creationLocation;
    return FlutterSelectionContext(
      targetSelection: TargetSelection(
        id: selected.node.id,
        label: selected.node.className,
        sourcePath: location?.file,
        sourceLine: location?.line,
        propertiesJson: jsonEncode(selected.propertiesJson),
        screenshotPath: selected.screenshotPath,
      ),
      flutterSelection: selected,
    );
  }
}
