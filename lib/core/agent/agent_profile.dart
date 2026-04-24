import 'package:pickforge/core/agent/models.dart';

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
}
