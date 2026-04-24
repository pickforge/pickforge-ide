import 'package:freezed_annotation/freezed_annotation.dart';

part 'connection_state.freezed.dart';

@freezed
abstract class ConnectionState with _$ConnectionState {
  const factory ConnectionState.idle({String? savedUrl}) = _Idle;

  const factory ConnectionState.connecting({required String url}) = _Connecting;

  const factory ConnectionState.connected({required String url}) = _Connected;

  const factory ConnectionState.error({
    required String url,
    required String message,
  }) = _Error;
}
