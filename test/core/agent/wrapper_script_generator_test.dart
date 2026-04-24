import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';

void main() {
  const generator = WrapperScriptGenerator();

  group('WrapperScriptGenerator', () {
    group('unix', () {
      test('generates bash script with cd and redirect', () {
        final script = generator.unix(
          projectRoot: '/path/to/project',
          agentBinary: 'claude',
          args: ['--skill', 'edit-widget'],
          promptPath: '/tmp/prompt.txt',
        );

        expect(script, contains('cd /path/to/project'));
        expect(script, contains('claude'));
        expect(script, contains('--skill'));
        expect(script, contains('edit-widget'));
        expect(script, contains('< /tmp/prompt.txt'));
      });

      test('handles empty args list', () {
        final script = generator.unix(
          projectRoot: '/proj',
          agentBinary: 'codex',
          args: [],
          promptPath: '/tmp/p.txt',
        );

        expect(script, contains('cd /proj'));
        expect(script, contains('codex'));
        expect(script, contains('< /tmp/p.txt'));
      });
    });

    group('windows', () {
      test('generates batch script with cd /d and pipe', () {
        final script = generator.windows(
          projectRoot: r'C:\path\to\project',
          agentBinary: 'claude.exe',
          args: ['--skill', 'edit-widget'],
          promptPath: r'C:\tmp\prompt.txt',
        );

        expect(script, contains(r'cd /d C:\path\to\project'));
        expect(script, contains('claude.exe'));
        expect(script, contains('--skill'));
        expect(script, contains('edit-widget'));
        expect(script, contains(r'type C:\tmp\prompt.txt |'));
      });

      test('handles empty args list', () {
        final script = generator.windows(
          projectRoot: r'C:\proj',
          agentBinary: 'codex.exe',
          args: [],
          promptPath: r'C:\tmp\p.txt',
        );

        expect(script, contains(r'cd /d C:\proj'));
        expect(script, contains('codex.exe'));
        expect(script, contains(r'type C:\tmp\p.txt |'));
      });
    });
  });
}
