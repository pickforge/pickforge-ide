import 'package:pickforge/core/agent/models.dart';

class PtyInvocation {
  const PtyInvocation({required this.executable, required this.arguments});

  final String executable;
  final List<String> arguments;
}

abstract class AgentProfile {
  const AgentProfile();

  AgentProfileId get id;
  String get displayName;
  String get binary;
  String get projectContextFile;
  List<String> invocationArgs();
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  });

  /// Returns the executable + args used to spawn this agent under a PTY for an
  /// interactive session in the embedded terminal pane.
  PtyInvocation ptyArgsFor({String? resumeSessionId});
}
