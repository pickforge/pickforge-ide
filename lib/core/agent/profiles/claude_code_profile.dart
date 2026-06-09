import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

class ClaudeCodeProfile extends AgentProfile {
  const ClaudeCodeProfile();

  @override
  AgentProfileId get id => AgentProfileId.claudeCode;

  @override
  String get displayName => 'Claude Code';

  @override
  String get binary => 'claude';

  @override
  String get projectContextFile => 'CLAUDE.md';

  @override
  List<String> invocationArgs() => [
        '--allowed-tools',
        'read',
        '--allowed-tools',
        'write',
      ];

  @override
  PtyInvocation ptyArgsFor({String? resumeSessionId, String? model}) =>
      PtyInvocation(
        executable: 'claude',
        arguments: [
          if (resumeSessionId != null) ...['--resume', resumeSessionId],
          if (model != null) ...['--model', model],
        ],
      );

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
