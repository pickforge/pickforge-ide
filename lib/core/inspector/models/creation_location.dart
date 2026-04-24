import 'package:freezed_annotation/freezed_annotation.dart';

part 'creation_location.g.dart';
part 'creation_location.freezed.dart';

@freezed
abstract class CreationLocation with _$CreationLocation {
  const factory CreationLocation({
    required String file,
    required int line,
    required int column,
  }) = _CreationLocation;

  factory CreationLocation.fromJson(Map<String, dynamic> json) =>
      _$CreationLocationFromJson(json);
}
