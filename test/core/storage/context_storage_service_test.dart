import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/pickforge_project_directory.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/storage/pickforge_env_vars.dart';
import 'package:pickforge/core/storage/project_id.dart';

void main() {
  late Directory tmp;
  late Directory tmpHome;
  late ContextStorageService service;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_storage');
    tmpHome = await Directory.systemTemp.createTemp('pf_home');
    service = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': tmpHome.path},
      isWindows: false,
    );
  });

  tearDown(() async {
    await tmp.delete(recursive: true);
    await tmpHome.delete(recursive: true);
  });

  void writeMarker(String root) {
    final dir = Directory(p.join(root, '.pickforge'))
      ..createSync(recursive: true);
    File(p.join(dir.path, '.gitignore')).writeAsStringSync('*\n');
  }

  test('auto-detects projectLocal when marker exists', () async {
    writeMarker(tmp.path);

    final resolved = await service.resolve(tmp.path);

    expect(resolved.isProjectLocal, isTrue);
    expect(resolved.contextDir, p.join(tmp.path, '.pickforge'));
  });

  for (final invalid in const ['*', '*\n\n', 'x\n', '']) {
    test(
      'auto-detect falls back to home when marker is ${jsonEncode(invalid)}',
      () async {
        final dir = Directory(p.join(tmp.path, '.pickforge'))
          ..createSync(recursive: true);
        File(p.join(dir.path, '.gitignore')).writeAsStringSync(invalid);

        final resolved = await service.resolve(tmp.path);

        expect(resolved.isProjectLocal, isFalse);
        expect(
          resolved.storageLocation,
          const ContextStorageLocation.pickforgeHome(),
        );
      },
    );
  }

  test('auto-detects pickforgeHome for a clean project', () async {
    final resolved = await service.resolve(tmp.path);
    final id = ProjectId.forRoot(tmp.path);
    final base = p.join(tmpHome.path, 'projects', id);

    expect(resolved.isProjectLocal, isFalse);
    expect(resolved.contextDir, p.join(base, 'context'));
    expect(resolved.runsDir, p.join(base, 'runs'));
    expect(resolved.chatsDir, p.join(base, 'chats'));
  });

  test('explicit custom places context under <tmp>/projects/<id>/context',
      () async {
    final custom = await Directory.systemTemp.createTemp('pf_custom');
    addTearDown(() async => custom.delete(recursive: true));

    final resolved = await service.resolve(
      tmp.path,
      location: ContextStorageLocation.custom(custom.path),
    );
    final id = ProjectId.forRoot(tmp.path);

    expect(
      resolved.contextDir,
      p.join(custom.path, 'projects', id, 'context'),
    );
  });

  test('explicit projectLocal yields flat .pickforge paths without a marker',
      () async {
    final resolved = await service.resolve(
      tmp.path,
      location: const ContextStorageLocation.projectLocal(),
    );

    expect(resolved.isProjectLocal, isTrue);
    expect(resolved.contextDir, p.join(tmp.path, '.pickforge'));
    expect(resolved.runsDir, p.join(tmp.path, '.pickforge', 'runs'));
    expect(resolved.chatsDir, p.join(tmp.path, '.pickforge', 'chats'));
  });

  test('ensure home mode creates contextDir with no .gitignore marker',
      () async {
    final resolved = await service.ensure(tmp.path);

    expect(Directory(resolved.contextDir).existsSync(), isTrue);
    expect(
      File(p.join(resolved.contextDir, '.gitignore')).existsSync(),
      isFalse,
    );
  });

  test('ensure home mode creates contextDir, runsDir and chatsDir', () async {
    final resolved = await service.ensure(tmp.path);

    expect(Directory(resolved.contextDir).existsSync(), isTrue);
    expect(Directory(resolved.runsDir).existsSync(), isTrue);
    expect(Directory(resolved.chatsDir).existsSync(), isTrue);
    expect(
      File(p.join(resolved.contextDir, '.gitignore')).existsSync(),
      isFalse,
    );
  });

  test('ensure home mode creates the home root when it does not pre-exist',
      () async {
    final homeNotCreated = p.join(tmp.path, 'home_not_created');
    final freshService = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': homeNotCreated},
      isWindows: false,
    );

    expect(Directory(homeNotCreated).existsSync(), isFalse);

    final resolved = await freshService.ensure(tmp.path);

    expect(Directory(resolved.contextDir).existsSync(), isTrue);
  });

  test('ensure custom mode creates contextDir, runsDir and chatsDir', () async {
    final tmpCustom = await Directory.systemTemp.createTemp('pf_custom');
    addTearDown(() async => tmpCustom.delete(recursive: true));

    final resolved = await service.ensure(
      tmp.path,
      location: ContextStorageLocation.custom(tmpCustom.path),
    );
    final id = ProjectId.forRoot(tmp.path);
    final base = p.join(tmpCustom.path, 'projects', id);

    expect(resolved.contextDir, p.join(base, 'context'));
    expect(Directory(resolved.contextDir).existsSync(), isTrue);
    expect(Directory(resolved.runsDir).existsSync(), isTrue);
    expect(Directory(resolved.chatsDir).existsSync(), isTrue);
  });

  test('ensure project-local creates .pickforge with the marker', () async {
    final resolved = await service.ensure(
      tmp.path,
      location: const ContextStorageLocation.projectLocal(),
    );

    expect(resolved.contextDir, p.join(tmp.path, '.pickforge'));
    expect(
      File(p.join(tmp.path, '.pickforge', '.gitignore')).readAsStringSync(),
      '*\n',
    );
  });

  test('ensure project-local throws when .pickforge lacks the marker',
      () async {
    Directory(p.join(tmp.path, '.pickforge')).createSync(recursive: true);

    await expectLater(
      service.ensure(
        tmp.path,
        location: const ContextStorageLocation.projectLocal(),
      ),
      throwsA(isA<PickforgeDirConflictException>()),
    );
  });

  test('ensure throws when projectRoot is missing', () async {
    final missing = p.join(tmp.path, 'does-not-exist');

    await expectLater(
      service.ensure(missing),
      throwsA(isA<PickforgeDirConflictException>()),
    );
  });

  test('project-local paths match the legacy join under the absolute root',
      () async {
    final resolved = await service.resolve(
      tmp.path,
      location: const ContextStorageLocation.projectLocal(),
    );

    expect(resolved.contextDir, p.join(tmp.path, '.pickforge'));
    expect(resolved.runsDir, p.join(tmp.path, '.pickforge', 'runs'));
    expect(resolved.chatsDir, p.join(tmp.path, '.pickforge', 'chats'));
  });

  test('project-local absolutizes a relative projectRoot everywhere', () async {
    final resolved = await service.resolve(
      'relative/project',
      location: const ContextStorageLocation.projectLocal(),
    );
    final absoluteRoot = Directory('relative/project').absolute.path;

    expect(resolved.projectRoot, absoluteRoot);
    expect(p.isAbsolute(resolved.projectRoot), isTrue);
    expect(p.isAbsolute(resolved.contextDir), isTrue);
    expect(p.isAbsolute(resolved.runsDir), isTrue);
    expect(p.isAbsolute(resolved.chatsDir), isTrue);
    expect(resolved.contextDir, p.join(absoluteRoot, '.pickforge'));
    expect(resolved.runsDir, p.join(absoluteRoot, '.pickforge', 'runs'));
    expect(resolved.chatsDir, p.join(absoluteRoot, '.pickforge', 'chats'));

    final env = pickforgeEnvVars(resolved);
    expect(p.isAbsolute(env['PICKFORGE_PROJECT_ROOT']!), isTrue);
    expect(p.isAbsolute(env['PICKFORGE_CONTEXT_DIR']!), isTrue);
    expect(env['PICKFORGE_PROJECT_ROOT'], absoluteRoot);
    expect(env['PICKFORGE_CONTEXT_DIR'], p.join(absoluteRoot, '.pickforge'));
  });

  test('custom paths are absolute for a relative custom path', () async {
    final resolved = await service.resolve(
      tmp.path,
      location: const ContextStorageLocation.custom('relative/custom'),
    );

    expect(p.isAbsolute(resolved.contextDir), isTrue);
    expect(p.isAbsolute(resolved.runsDir), isTrue);
    expect(p.isAbsolute(resolved.chatsDir), isTrue);
  });

  test('ensure custom creates dirs and writes no marker', () async {
    final custom = await Directory.systemTemp.createTemp('pf_custom');
    addTearDown(() async => custom.delete(recursive: true));

    final resolved = await service.ensure(
      tmp.path,
      location: ContextStorageLocation.custom(custom.path),
    );

    expect(Directory(resolved.contextDir).existsSync(), isTrue);
    expect(Directory(resolved.runsDir).existsSync(), isTrue);
    expect(Directory(resolved.chatsDir).existsSync(), isTrue);
    for (final dir in [
      resolved.contextDir,
      resolved.runsDir,
      resolved.chatsDir,
    ]) {
      expect(
        File(p.join(dir, '.gitignore')).existsSync(),
        isFalse,
        reason: 'no marker should be written under $dir',
      );
    }
    expect(
      File(p.join(tmp.path, '.pickforge', '.gitignore')).existsSync(),
      isFalse,
    );
  });

  group('persisted override', () {
    late PickforgeDatabase db;
    late ProjectSettingsRepository repo;
    late ContextStorageService svc;

    setUp(() {
      db = PickforgeDatabase.forTesting(NativeDatabase.memory());
      repo = ProjectSettingsRepository(db);
      svc = ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': tmpHome.path},
        isWindows: false,
        settings: repo,
      );
    });

    tearDown(() => db.close());

    test('persisted home beats an existing project-local marker', () async {
      writeMarker(tmp.path); // would otherwise auto-detect projectLocal
      await repo.setContextStorageLocation(
        tmp.path,
        const ContextStorageLocation.pickforgeHome(),
      );

      final resolved = await svc.resolve(tmp.path);

      expect(resolved.isProjectLocal, isFalse);
      expect(
        resolved.storageLocation,
        const ContextStorageLocation.pickforgeHome(),
      );
    });

    test('persisted project-local beats the clean-project home default',
        () async {
      await repo.setContextStorageLocation(
        tmp.path,
        const ContextStorageLocation.projectLocal(),
      );

      final resolved = await svc.resolve(tmp.path);

      expect(resolved.isProjectLocal, isTrue);
      expect(
        resolved.contextDir,
        p.join(Directory(tmp.path).absolute.path, '.pickforge'),
      );
    });

    test('persisted custom resolves under the custom root', () async {
      final custom = await Directory.systemTemp.createTemp('pf_custom');
      addTearDown(() async => custom.delete(recursive: true));
      await repo.setContextStorageLocation(
        tmp.path,
        ContextStorageLocation.custom(custom.path),
      );

      final resolved = await svc.resolve(tmp.path);
      final id = ProjectId.forRoot(tmp.path);

      expect(
        resolved.contextDir,
        p.join(custom.path, 'projects', id, 'context'),
      );
    });

    test('explicit location parameter still beats the persisted override',
        () async {
      await repo.setContextStorageLocation(
        tmp.path,
        const ContextStorageLocation.pickforgeHome(),
      );

      final resolved = await svc.resolve(
        tmp.path,
        location: const ContextStorageLocation.projectLocal(),
      );

      expect(resolved.isProjectLocal, isTrue);
    });

    test('no persisted override falls back to auto-detect', () async {
      writeMarker(tmp.path);

      final resolved = await svc.resolve(tmp.path);

      expect(resolved.isProjectLocal, isTrue);
    });
  });
}
