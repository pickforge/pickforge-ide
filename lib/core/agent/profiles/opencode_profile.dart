import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

class OpenCodeProfile extends AgentProfile {
  const OpenCodeProfile();

  @override
  AgentProfileId get id => AgentProfileId.opencode;

  @override
  String get displayName => 'OpenCode';

  @override
  String get binary => 'opencode';

  @override
  String get projectContextFile => 'AGENTS.md';

  @override
  List<String> invocationArgs() => ['--yolo'];

  @override
  PtyInvocation ptyArgsFor({String? resumeSessionId}) =>
      const PtyInvocation(executable: 'opencode', arguments: <String>[]);

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
