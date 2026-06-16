import 'package:equatable/equatable.dart';

/// The current picked element within a target — a Flutter widget, an
/// accessibility node, a DOM node, etc.
///
/// Intentionally generic; target-specific richness (Flutter widget trees and
/// their properties) lives in the target's own layer and is surfaced
/// separately.
class TargetSelection extends Equatable {
  const TargetSelection({
    required this.id,
    required this.label,
    this.sourcePath,
    this.sourceLine,
    this.propertiesJson,
    this.screenshotPath,
  });

  final String id;
  final String label;
  final String? sourcePath;
  final int? sourceLine;
  final String? propertiesJson;
  final String? screenshotPath;

  @override
  List<Object?> get props => [
        id,
        label,
        sourcePath,
        sourceLine,
        propertiesJson,
        screenshotPath,
      ];
}
