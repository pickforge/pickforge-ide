import 'package:freezed_annotation/freezed_annotation.dart';

part 'inspector_status.freezed.dart';

@freezed
abstract class InspectorStatus with _$InspectorStatus {
  const factory InspectorStatus.disconnected() = _Disconnected;
  const factory InspectorStatus.connecting() = _Connecting;
  const factory InspectorStatus.connected({required bool selectModeOn}) =
      _Connected;
  const factory InspectorStatus.error(String message) = _Error;
}
