import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

part 'emulator_session_state.freezed.dart';

@freezed
sealed class EmulatorSessionState with _$EmulatorSessionState {
  const factory EmulatorSessionState.noDevicePicked() = NoDevicePicked;

  const factory EmulatorSessionState.cold({required Avd avd}) = Cold;

  const factory EmulatorSessionState.booting({
    required Avd avd,
    @Default(0) int elapsedMs,
  }) = Booting;

  const factory EmulatorSessionState.idle({
    required Avd avd,
    required String serial,
  }) = Idle;

  factory EmulatorSessionState.running({
    Avd? avd,
    String? serial,
    String? appId,
    required String vmServiceUri,
    required RunStats stats,
    @Default(false) bool manual,
    DateTime? lastReloadAt,
  }) = Running;

  const factory EmulatorSessionState.reconnecting({
    required Avd avd,
    required String serial,
    required String appId,
    @Default(1) int attempt,
  }) = Reconnecting;

  const factory EmulatorSessionState.error({
    Avd? avd,
    String? serial,
    String? lastVmServiceUri,
    required String message,
  }) = EmulatorError;
}
