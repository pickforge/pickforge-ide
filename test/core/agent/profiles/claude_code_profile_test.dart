import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';

void main() {
  group('ClaudeCodeProfile', () {
    const profile = ClaudeCodeProfile();

    test('id is claudeCode', () {
      expect(profile.id, AgentProfileId.claudeCode);
    });

    test('displayName is Claude Code', () {
      expect(profile.displayName, 'Claude Code');
    });

    test('binary is claude', () {
      expect(profile.binary, 'claude');
    });

    test('projectContextFile is CLAUDE.md', () {
      expect(profile.projectContextFile, 'CLAUDE.md');
    });

    test('invocationArgs returns correct args', () {
      expect(
        profile.invocationArgs(),
        ['--allowed-tools', 'read', '--allowed-tools', 'write'],
      );
    });

    test('ptyArgsFor returns claude invocation without resume', () {
      final inv = profile.ptyArgsFor();
      expect(inv.executable, 'claude');
      expect(inv.arguments, isEmpty);
    });

    test('ptyArgsFor includes --resume <id> when given', () {
      final inv = profile.ptyArgsFor(resumeSessionId: 'sess-42');
      expect(inv.executable, 'claude');
      expect(inv.arguments, ['--resume', 'sess-42']);
    });

    test('buildInitialPrompt with all files', () {
      final prompt = profile.buildInitialPrompt(
        pickforgeDirRelative: '.pickforge',
        skillFilename: 'skill.md',
        widgetContextFilename: 'widget-context.md',
        screenshotFilename: 'screenshot.png',
        deviceScreenFilename: 'device-screen.png',
      );

      expect(prompt, contains('skill.md'));
      expect(prompt, contains('widget-context.md'));
      expect(prompt, contains('screenshot.png'));
      expect(prompt, contains('device-screen.png'));
      // Skill listed before widget-context
      expect(
        prompt.indexOf('skill.md'),
        lessThan(prompt.indexOf('widget-context.md')),
      );
    });

    test('buildInitialPrompt omits null optional files', () {
      final prompt = profile.buildInitialPrompt(
        pickforgeDirRelative: '.pickforge',
        skillFilename: 'skill.md',
        widgetContextFilename: 'widget-context.md',
        screenshotFilename: null,
        deviceScreenFilename: null,
      );

      expect(prompt, contains('skill.md'));
      expect(prompt, contains('widget-context.md'));
      expect(prompt, isNot(contains('screenshot')));
      expect(prompt, isNot(contains('device-screen')));
    });
  });
}
