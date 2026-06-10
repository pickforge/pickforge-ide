import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/cursor_profile.dart';

void main() {
  group('CursorProfile', () {
    const profile = CursorProfile();

    test('id is cursor', () {
      expect(profile.id, AgentProfileId.cursor);
    });

    test('displayName is Cursor', () {
      expect(profile.displayName, 'Cursor');
    });

    test('binary is agent', () {
      expect(profile.binary, 'agent');
    });

    test('projectContextFile is AGENTS.md', () {
      expect(profile.projectContextFile, 'AGENTS.md');
    });

    test('invocationArgs returns prompt mode args', () {
      expect(profile.invocationArgs(), ['-p']);
    });

    test('launchCommand is the bare binary without a model', () {
      expect(profile.launchCommand(), 'agent');
    });

    test('launchCommand appends --model when given', () {
      expect(
        profile.launchCommand(model: 'composer-2'),
        'agent --model composer-2',
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
