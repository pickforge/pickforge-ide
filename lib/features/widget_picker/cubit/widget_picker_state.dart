import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/inspector/models.dart';

part 'widget_picker_state.freezed.dart';

@freezed
abstract class WidgetPickerState with _$WidgetPickerState {
  const factory WidgetPickerState({
    required SelectedWidget? selection,
    required bool selectModeEnabled,
  }) = _WidgetPickerState;

  factory WidgetPickerState.initial() => const WidgetPickerState(
        selection: null,
        selectModeEnabled: false,
      );
}
