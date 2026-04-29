import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/emulator/device_models.dart';

part 'device_picker_state.freezed.dart';

@freezed
sealed class DevicePickerState with _$DevicePickerState {
  const factory DevicePickerState.initial() = Initial;
  const factory DevicePickerState.loading() = Loading;
  const factory DevicePickerState.loaded({
    required List<Avd> avds,
    required List<RunningAndroidDevice> running,
  }) = Loaded;
  const factory DevicePickerState.error(String message) = PickerError;
}
