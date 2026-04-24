import 'package:freezed_annotation/freezed_annotation.dart';

part 'connection_event.freezed.dart';

@freezed
abstract class ConnectionEvent with _$ConnectionEvent {
  const factory ConnectionEvent.bootstrap({required String projectRoot}) =
      _Bootstrap;

  const factory ConnectionEvent.connectPressed({required String url}) =
      _ConnectPressed;

  const factory ConnectionEvent.disconnectPressed() = _DisconnectPressed;
}
