import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';

void main() {
  group('OpenCodeProfile', () {
    const profile = OpenCodeProfile();

    test('id is opencode', () {
      expect(profile.id, AgentProfileId.opencode);
    });

    test('displayName is OpenCode', () {
      expect(profile.displayName, 'OpenCode');
    });

    test('binary is opencode', () {
      expect(profile.binary, 'opencode');
    });

    test('projectContextFile is AGENTS.md', () {
      expect(profile.projectContextFile, 'AGENTS.md');
    });

    test('invocationArgs returns correct args', () {
      expect(profile.invocationArgs(), ['--yolo']);
    });

    test('launchCommand is the bare binary without a model', () {
      expect(profile.launchCommand(), 'opencode');
    });

    test('launchCommand appends --model when given', () {
      expect(
        profile.launchCommand(model: 'anthropic/claude-haiku-4-5'),
        'opencode --model anthropic/claude-haiku-4-5',
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
