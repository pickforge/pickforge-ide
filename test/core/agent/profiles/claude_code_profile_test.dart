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

    test('launchCommand is the bare binary without a model', () {
      expect(profile.launchCommand(), 'claude');
    });

    test('launchCommand appends --model when given', () {
      expect(
        profile.launchCommand(model: 'claude-haiku-4-5'),
        'claude --model claude-haiku-4-5',
      );
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
