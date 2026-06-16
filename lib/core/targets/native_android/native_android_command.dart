import 'package:equatable/equatable.dart';

/// A resolved native-Android process invocation built deterministically before
/// anything is spawned through a process runner.
class NativeAndroidCommand extends Equatable {
  const NativeAndroidCommand({
    required this.executable,
    required this.arguments,
    required this.cwd,
    this.env,
  });

  final String executable;
  final List<String> arguments;
  final String cwd;
  final Map<String, String>? env;

  @override
  List<Object?> get props => [executable, arguments, cwd, env];
}
