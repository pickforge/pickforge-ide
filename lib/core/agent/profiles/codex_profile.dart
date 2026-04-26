import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

class CodexProfile extends AgentProfile {
  const CodexProfile();

  @override
  AgentProfileId get id => AgentProfileId.codex;

  @override
  String get displayName => 'Codex';

  @override
  String get binary => 'codex';

  @override
  String get projectContextFile => 'AGENTS.md';

  @override
  List<String> invocationArgs() => ['--dangerously-skip-permissions'];

  @override
  PtyInvocation ptyArgsFor({String? resumeSessionId}) =>
      const PtyInvocation(executable: 'codex', arguments: <String>[]);

  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) {
    final lines = <String>[
      '- Read $skillFilename',
      '- Read $widgetContextFilename',
    ];

    if (screenshotFilename != null) {
      lines.add('- Read $screenshotFilename');
    }
    if (deviceScreenFilename != null) {
      lines.add('- Read $deviceScreenFilename');
    }

    return lines.join('\n');
  }
}
