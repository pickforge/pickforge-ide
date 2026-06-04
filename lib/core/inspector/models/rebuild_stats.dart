import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/inspector/models/creation_location.dart';

part 'rebuild_stats.g.dart';
part 'rebuild_stats.freezed.dart';

@freezed
abstract class RebuildStats with _$RebuildStats {
  const factory RebuildStats({
    required int? frameNumber,
    required int? startTime,
    required List<RebuiltWidget> widgets,
  }) = _RebuildStats;

  factory RebuildStats.fromJson(Map<String, dynamic> json) =>
      _$RebuildStatsFromJson(json);
}

@freezed
abstract class RebuiltWidget with _$RebuiltWidget {
  const factory RebuiltWidget({
    required String className,
    required CreationLocation location,
    required int count,
  }) = _RebuiltWidget;

  factory RebuiltWidget.fromJson(Map<String, dynamic> json) =>
      _$RebuiltWidgetFromJson(json);
}
