import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/prompt_template_renderer.dart';

void main() {
  group('PromptTemplateRenderer', () {
    const renderer = PromptTemplateRenderer();

    test('renders placeholders and numbered file lists', () {
      final output = renderer.render(
        '{{agent_id}} {{skill_id}} {{project_context_file}}\n'
        '{{read_files_numbered}}\n'
        '{{optional_files_bullets}}',
        const PromptTemplateVariables(
          agentId: 'codex',
          skillId: 'edit-widget',
          projectContextFile: 'AGENTS.md',
          pickforgeDirRelative: '.pickforge',
          skillFilename: 'skill-active.md',
          widgetContextFilename: 'widget-context.md',
          screenshotFilename: 'screenshot.png',
          deviceScreenFilename: 'device-screen.png',
        ),
      );

      expect(output, contains('codex edit-widget AGENTS.md'));
      expect(output, contains('1. Read .pickforge/skill-active.md'));
      expect(output, contains('2. Read .pickforge/widget-context.md'));
      expect(output, contains('3. Read .pickforge/screenshot.png'));
      expect(output, contains('- Read .pickforge/device-screen.png'));
      expect(output, isNot(contains('{{')));
    });

    test('omits optional files when no screenshots are present', () {
      final output = renderer.render(
        '{{read_files_bullets}}\n\n{{optional_files_bullets}}',
        const PromptTemplateVariables(
          agentId: 'opencode',
          skillId: 'explain-widget',
          projectContextFile: 'AGENTS.md',
          pickforgeDirRelative: '.pickforge',
          skillFilename: 'skill-active.md',
          widgetContextFilename: 'widget-context.md',
          screenshotFilename: null,
          deviceScreenFilename: null,
        ),
      );

      expect(
          output,
          '- Read .pickforge/skill-active.md\n'
          '- Read .pickforge/widget-context.md');
    });
  });
}
