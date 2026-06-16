import 'package:equatable/equatable.dart';

/// A resolved iOS process invocation (xcodebuild / `xcrun simctl`), built
/// deterministically before anything is spawned. Execution is macOS-only, but
/// the command itself is pure and testable anywhere.
class IosCommand extends Equatable {
  const IosCommand({
    required this.executable,
    required this.arguments,
    this.cwd,
  });

  final String executable;
  final List<String> arguments;

  /// Working directory — set for xcodebuild (the workspace/project name is
  /// relative); null for the project-independent simctl commands.
  final String? cwd;

  @override
  List<Object?> get props => [executable, arguments, cwd];
}
