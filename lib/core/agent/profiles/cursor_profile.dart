import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

class CursorProfile extends AgentProfile {
  const CursorProfile();

  @override
  AgentProfileId get id => AgentProfileId.cursor;

  @override
  String get displayName => 'Cursor';

  @override
  String get binary => 'agent';

  @override
  String get projectContextFile => 'AGENTS.md';

  @override
  List<String> invocationArgs() => ['-p'];

  @override
  PtyInvocation ptyArgsFor({String? resumeSessionId}) => PtyInvocation(
        executable: 'agent',
        arguments:
            resumeSessionId != null ? ['--resume=$resumeSessionId'] : const [],
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
