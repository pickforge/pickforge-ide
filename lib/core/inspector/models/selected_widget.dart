import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/inspector/models/widget_node.dart';

part 'selected_widget.g.dart';
part 'selected_widget.freezed.dart';

@freezed
abstract class SelectedWidget with _$SelectedWidget {
  const factory SelectedWidget({
    required WidgetNode node,
    required List<String> ancestorClasses,
    required String? sourceSnippet,
    required String? screenshotPath,
    required String? adbScreenshotPath,
    required Map<String, dynamic> propertiesJson,
  }) = _SelectedWidget;

  factory SelectedWidget.fromJson(Map<String, dynamic> json) =>
      _$SelectedWidgetFromJson(json);
}
