import 'package:equatable/equatable.dart';

/// Options for the Metro development server.
class ReactNativeMetroOptions extends Equatable {
  const ReactNativeMetroOptions({
    this.port = 8081,
    this.host = '127.0.0.1',
    this.resetCache = false,
  });

  final int port;
  final String host;
  final bool resetCache;

  @override
  List<Object?> get props => [port, host, resetCache];
}

/// A resolved process invocation: what to run, where, and with which args.
///
/// A plain value object so commands are built and asserted deterministically
/// before anything is spawned through a process runner.
class ReactNativeCommand extends Equatable {
  const ReactNativeCommand({
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
