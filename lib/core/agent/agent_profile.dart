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

  /// The shell command a quick-launch chip types into the embedded terminal.
  /// The user reviews/edits it and presses Enter; PickForge never runs it.
  ///
  /// [model] pins the agent to a specific model (e.g. Claude → Haiku 4.5,
  /// Codex → GPT-5.3 Codex Spark). When null, the agent CLI's own default is
  /// used. See `AgentModelSettings`.
  String launchCommand({String? model}) => [
        binary,
        if (model != null) ...['--model', model],
      ].join(' ');
}
