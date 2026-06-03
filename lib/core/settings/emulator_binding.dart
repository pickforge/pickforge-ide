import 'package:freezed_annotation/freezed_annotation.dart';

part 'emulator_binding.freezed.dart';

@freezed
abstract class EmulatorBinding with _$EmulatorBinding {
  const factory EmulatorBinding.avd({
    required String avdId,
    required String avdName,
    @Default(true) bool autoBootOnSelect,
  }) = AvdBinding;

  const factory EmulatorBinding.physical({
    required String serial,
    required String name,
  }) = PhysicalDeviceBinding;

  const factory EmulatorBinding.iosSimulator({
    required String simulatorId,
    required String name,
  }) = IosSimulatorBinding;

  const factory EmulatorBinding.manual({
    required String vmServiceUrl,
  }) = ManualBinding;
}
