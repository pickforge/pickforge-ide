import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/gemini_profile.dart';

void main() {
  group('GeminiProfile', () {
    const profile = GeminiProfile();

    test('id is gemini', () {
      expect(profile.id, AgentProfileId.gemini);
    });

    test('displayName is Gemini', () {
      expect(profile.displayName, 'Gemini');
    });

    test('binary is gemini', () {
      expect(profile.binary, 'gemini');
    });

    test('projectContextFile is GEMINI.md', () {
      expect(profile.projectContextFile, 'GEMINI.md');
    });

    test('invocationArgs returns prompt mode args', () {
      expect(profile.invocationArgs(), ['-p']);
    });

    test('ptyArgsFor returns gemini invocation without resume', () {
      final inv = profile.ptyArgsFor();
      expect(inv.executable, 'gemini');
      expect(inv.arguments, ['--approval-mode=auto_edit']);
    });

    test('ptyArgsFor includes resume id', () {
      final inv = profile.ptyArgsFor(resumeSessionId: 'latest');
      expect(inv.executable, 'gemini');
      expect(inv.arguments, ['--approval-mode=auto_edit', '--resume=latest']);
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
