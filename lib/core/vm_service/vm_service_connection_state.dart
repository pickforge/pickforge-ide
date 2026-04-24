import 'package:freezed_annotation/freezed_annotation.dart';

part 'vm_service_connection_state.freezed.dart';

@freezed
abstract class VmServiceConnectionState with _$VmServiceConnectionState {
  const factory VmServiceConnectionState.idle() = _Idle;

  const factory VmServiceConnectionState.connecting({required int attempt}) =
      _Connecting;

  const factory VmServiceConnectionState.connected({required String url}) =
      _Connected;

  const factory VmServiceConnectionState.error({
    required String message,
    required int attempt,
  }) = _Error;
}
