import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';

void main() {
  group('PickforgeDirManager', () {
    late PickforgeDirManager manager;

    setUp(() {
      manager = PickforgeDirManager();
    });

    group('ensure', () {
      test('creates .pickforge/.gitignore with star pattern', () async {
        final tempDir = Directory.systemTemp.createTempSync('pickforge_test_');
        try {
          await manager.ensure(projectRoot: tempDir.path);

          final gitignore = File('${tempDir.path}/.pickforge/.gitignore');
          expect(gitignore.existsSync(), isTrue);
          expect(gitignore.readAsStringSync(), equals('*\n'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('succeeds when .pickforge already has our .gitignore', () async {
        final tempDir = Directory.systemTemp.createTempSync('pickforge_test_');
        try {
          final pickforgeDir = Directory('${tempDir.path}/.pickforge')
            ..createSync();
          File('${pickforgeDir.path}/.gitignore').writeAsStringSync('*\n');

          // Should not throw — already has our marker
          await manager.ensure(projectRoot: tempDir.path);
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test(
        'throws PickforgeDirConflictException '
        'when .pickforge exists without our .gitignore',
        () async {
          final tempDir =
              Directory.systemTemp.createTempSync('pickforge_test_');
          try {
            Directory('${tempDir.path}/.pickforge').createSync();

            expect(
              () => manager.ensure(projectRoot: tempDir.path),
              throwsA(isA<PickforgeDirConflictException>()),
            );
          } finally {
            tempDir.deleteSync(recursive: true);
          }
        },
      );
    });

    group('writeContext', () {
      test(
        'writes skill-active.md, widget-context.md, and run-log.json',
        () async {
          final tempDir =
              Directory.systemTemp.createTempSync('pickforge_test_');
          try {
            await manager.ensure(projectRoot: tempDir.path);

            await manager.writeContext(
              projectRoot: tempDir.path,
              skillContent: '# Active Skill',
              widgetContextContent: 'Widget: Container',
              runLogContent: '{"runs": []}',
            );

            final pickforgeDir = Directory('${tempDir.path}/.pickforge');
            expect(
              File('${pickforgeDir.path}/skill-active.md').existsSync(),
              isTrue,
            );
            expect(
              File('${pickforgeDir.path}/widget-context.md').existsSync(),
              isTrue,
            );
            expect(
              File('${pickforgeDir.path}/run-log.json').existsSync(),
              isTrue,
            );

            expect(
              File('${pickforgeDir.path}/skill-active.md').readAsStringSync(),
              equals('# Active Skill'),
            );
          } finally {
            tempDir.deleteSync(recursive: true);
          }
        },
      );
    });
  });
}
