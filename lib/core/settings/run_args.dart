import 'package:freezed_annotation/freezed_annotation.dart';

part 'run_args.freezed.dart';

@freezed
abstract class RunArgs with _$RunArgs {
  const factory RunArgs({
    String? targetFile,
    @Default(<String>[]) List<String> extraArgs,
  }) = _RunArgs;
}
