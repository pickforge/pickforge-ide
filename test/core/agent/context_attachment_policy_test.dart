import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/context_attachment_policy.dart';

void main() {
  const policy = ContextAttachmentPolicy();

  test('blocks secret basenames and binary extensions', () {
    expect(policy.blockedReason('.env'), contains('secret'));
    expect(policy.blockedReason('config/.env.local'), contains('secret'));
    expect(policy.blockedReason('lib/logo.png'), contains('binary'));
    expect(policy.blockedReason('lib/main.dart'), isNull);
  });

  test('blocks the legacy project-local .pickforge dir', () {
    expect(
      policy.blockedReason('.pickforge/skill-active.md'),
      contains('Pickforge local context'),
    );
  });

  test('blocks a path resolving under the resolved context dir', () {
    const projectRoot = '/home/dev/app';
    // A custom/home context dir nested inside the project: a relative path
    // that resolves under it must be treated as internal even though the
    // legacy `.pickforge/` prefix guard does not match.
    const contextDir = '/home/dev/app/.forge/context';

    expect(
      policy.blockedReason(
        '.forge/context/skill-active.md',
        projectRoot: projectRoot,
        contextDir: contextDir,
      ),
      contains('Pickforge local context'),
    );
  });

  test('keeps ordinary project files attachable in home mode', () {
    expect(
      policy.blockedReason(
        'lib/main.dart',
        projectRoot: '/home/dev/app',
        contextDir: '/home/dev/app/.forge/context',
      ),
      isNull,
    );
  });
}
