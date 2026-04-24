import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/terminal/models/terminal_profile_id.dart';

part 'terminal_launch_spec.freezed.dart';
part 'terminal_launch_spec.g.dart';

class _TerminalIdConverter
    implements JsonConverter<TerminalProfileId, String> {
  const _TerminalIdConverter();
  @override
  TerminalProfileId fromJson(String json) => TerminalProfileId.fromValue(json);
  @override
  String toJson(TerminalProfileId object) => object.value;
}

@freezed
abstract class TerminalLaunchSpec with _$TerminalLaunchSpec {
  const factory TerminalLaunchSpec({
    @_TerminalIdConverter() required TerminalProfileId id,
    required String scriptPath,
    required String workingDir,
    required Map<String, String> env,
  }) = _TerminalLaunchSpec;

  factory TerminalLaunchSpec.fromJson(Map<String, dynamic> json) =>
      _$TerminalLaunchSpecFromJson(json);
}
