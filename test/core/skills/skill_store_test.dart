import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/skills/models.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SkillStore', () {
    late SkillStore store;
    late ContextStorageService storage;
    late Directory home;

    setUp(() {
      home = Directory.systemTemp.createTempSync('skillstore_home_');
      storage = ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': home.path},
        isWindows: false,
      );
      store = SkillStore(storage);
    });

    tearDown(() => home.deleteSync(recursive: true));

    /// Marks [root] as a project-local PickForge project so [storage] resolves
    /// its skills/prompt-templates under `<root>/.pickforge/`.
    void markProjectLocal(Directory root) {
      Directory(p.join(root.path, '.pickforge')).createSync(recursive: true);
      File(p.join(root.path, '.pickforge', '.gitignore'))
          .writeAsStringSync('*\n');
    }

    group('loadSkill', () {
      test('falls back to bundled asset when no override exists', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final content = await store.loadSkill(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, contains('# Skill: Edit Widget'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('prefers project-local override over bundled asset', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          markProjectLocal(tempDir);
          final overrideDir = Directory(
            '${tempDir.path}/.pickforge/skills',
          )..createSync(recursive: true);

          File('${overrideDir.path}/edit-widget.md').writeAsStringSync(
            '# Override Skill',
          );

          final content = await store.loadSkill(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, equals('# Override Skill'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('loads a home-mode override from the resolved skills dir', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final resolved = await storage.resolve(tempDir.path);
          expect(resolved.isProjectLocal, isFalse);
          final overrideDir = Directory(resolved.skillsDir)
            ..createSync(recursive: true);
          File('${overrideDir.path}/edit-widget.md')
              .writeAsStringSync('# Home Override Skill');

          final content = await store.loadSkill(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, equals('# Home Override Skill'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('falls back to asset when override dir exists but no file',
          () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          markProjectLocal(tempDir);
          Directory('${tempDir.path}/.pickforge/skills').createSync(
            recursive: true,
          );

          final content = await store.loadSkill(
            SkillId.extractWidget,
            projectRoot: tempDir.path,
          );
          expect(content, contains('# Skill: Extract Widget'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });
    });

    group('resolveSkillSource', () {
      test('project-local and home skillsDir resolve to identical paths',
          () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          markProjectLocal(tempDir);
          final localDir = (await storage.resolve(
            tempDir.path,
            location: const ContextStorageLocation.projectLocal(),
          ))
              .skillsDir;
          expect(localDir, '${tempDir.path}/.pickforge/skills');
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('returns bundled asset source when no override exists', () {
        final source = store.resolveSkillSource(
          SkillId.editWidget,
          skillsDir: '${home.path}/missing/skills',
        );

        expect(source.type, SkillSourceType.bundledAsset);
        expect(source.location, 'assets/skills/edit-widget.md');
      });

      test('returns project override source when override exists', () {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final overrideDir = Directory(
            '${tempDir.path}/skills',
          )..createSync(recursive: true);
          final overrideFile = File('${overrideDir.path}/edit-widget.md')
            ..writeAsStringSync('# Override Skill');

          final source = store.resolveSkillSource(
            SkillId.editWidget,
            skillsDir: overrideDir.path,
          );

          expect(source.type, SkillSourceType.projectOverride);
          expect(source.location, overrideFile.path);
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });
    });

    group('loadPromptTemplate', () {
      test('loads bundled template for agent and skill', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final content = await store.loadPromptTemplate(
            agentId: 'codex',
            skill: SkillId.extractWidget,
            projectRoot: tempDir.path,
          );

          expect(content, contains('extract the selected widget'));
          expect(content, contains('{{read_files_bullets}}'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('prefers project-local agent and skill template override', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          markProjectLocal(tempDir);
          final overrideDir = Directory(
            '${tempDir.path}/.pickforge/prompt-templates',
          )..createSync(recursive: true);
          File('${overrideDir.path}/opencode-edit-widget.md.tmpl')
              .writeAsStringSync('custom opencode edit prompt');

          final content = await store.loadPromptTemplate(
            agentId: 'opencode',
            skill: SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, 'custom opencode edit prompt');
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('loads a home-mode template override from the resolved dir',
          () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final resolved = await storage.resolve(tempDir.path);
          expect(resolved.isProjectLocal, isFalse);
          final overrideDir = Directory(resolved.promptTemplatesDir)
            ..createSync(recursive: true);
          File('${overrideDir.path}/opencode-edit-widget.md.tmpl')
              .writeAsStringSync('home opencode edit prompt');

          final content = await store.loadPromptTemplate(
            agentId: 'opencode',
            skill: SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, 'home opencode edit prompt');
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('falls back to project-local agent template override', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final overrideDir = Directory(
            '${tempDir.path}/prompt-templates',
          )..createSync(recursive: true);
          File('${overrideDir.path}/gemini.md.tmpl')
              .writeAsStringSync('custom gemini prompt');

          final source = store.resolvePromptTemplateSource(
            agentId: 'gemini',
            skill: SkillId.explainWidget,
            templatesDir: overrideDir.path,
          );

          expect(source.type, SkillSourceType.projectOverride);
          expect(source.location, '${overrideDir.path}/gemini.md.tmpl');
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });
    });

    group('loadAgentTemplate', () {
      test('loads CLAUDE.md.tmpl when forClaude is true', () async {
        final content = await store.loadAgentTemplate(forClaude: true);
        expect(content, contains('Claude Code'));
      });

      test('loads AGENTS.md.tmpl when forClaude is false', () async {
        final content = await store.loadAgentTemplate(forClaude: false);
        expect(content, contains('Codex / OpenCode'));
      });
    });
  });
}
