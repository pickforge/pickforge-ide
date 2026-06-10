import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

class GeminiProfile extends AgentProfile {
  const GeminiProfile();

  @override
  AgentProfileId get id => AgentProfileId.gemini;

  @override
  String get displayName => 'Gemini';

  @override
  String get binary => 'gemini';

  @override
  String get projectContextFile => 'GEMINI.md';

  @override
  List<String> invocationArgs() => ['-p'];

  @override
  String launchCommand({String? model}) => [
        binary,
        '--approval-mode=auto_edit',
        if (model != null) ...['--model', model],
      ].join(' ');

  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) {
    final lines = <String>[
      '1. Read $skillFilename',
      '2. Read $widgetContextFilename',
    ];

    var step = 3;
    if (screenshotFilename != null) {
      lines.add('$step. Read $screenshotFilename');
      step++;
    }
    if (deviceScreenFilename != null) {
      lines.add('$step. Read $deviceScreenFilename');
    }

    return lines.join('\n');
  }
}
