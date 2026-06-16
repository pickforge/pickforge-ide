import 'package:equatable/equatable.dart';

/// How confident an adapter is that a project root matches its target.
enum DetectionConfidence {
  /// Unambiguous match (e.g. a Flutter project with `pubspec.yaml`).
  exact,

  /// Probable match from softer signals.
  likely,

  /// Last-resort match used by the generic fallback adapter.
  fallback,
}

/// The result of running a [TargetDetector] against a project root.
class TargetDetection extends Equatable {
  const TargetDetection({
    required this.targetId,
    required this.confidence,
    this.details,
  });

  final String targetId;
  final DetectionConfidence confidence;
  final Map<String, String>? details;

  @override
  List<Object?> get props => [targetId, confidence, details];
}

/// Detects whether a project root belongs to a particular target.
///
/// A deliberate single-method seam: concrete adapters (2B's
/// `GenericProjectAdapter`, M3's `FlutterTargetAdapter`) implement detection.
// ignore: one_member_abstracts
abstract class TargetDetector {
  /// Returns a [TargetDetection] when the project root matches this target,
  /// or `null` when it does not.
  Future<TargetDetection?> detect(String projectRoot);
}
