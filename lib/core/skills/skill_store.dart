import 'dart:io';

import 'package:flutter/services.dart';
import 'package:pickforge/core/skills/models.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

enum SkillSourceType { projectOverride, bundledAsset }

class SkillSource {
  const SkillSource({
    required this.type,
    required this.location,
  });

  final SkillSourceType type;
  final String location;

  bool get isProjectOverride => type == SkillSourceType.projectOverride;
}

/// Loads skill markdown files and agent templates.
///
/// Prefers project-local overrides in the resolved context dir's `skills/`
/// before falling back to bundled assets in `assets/skills/`.
///
/// Not annotated with `@lazySingleton` — wired via `@module` in injection.dart.
class SkillStore {
  SkillStore(this._storage, [AssetBundle? bundle]) : _bundle = bundle;

  final ContextStorageService _storage;
  final AssetBundle? _bundle;

  AssetBundle get _effectiveBundle => _bundle ?? rootBundle;

  /// Loads a skill by [id], preferring a project-local override in the resolved
  /// `skills/{id.value}.md`, falling back to the bundled asset.
  Future<String> loadSkill(
    SkillId id, {
    required String projectRoot,
  }) async {
    final resolved = await _storage.resolve(projectRoot);
    final source = resolveSkillSource(id, skillsDir: resolved.skillsDir);
    if (source.isProjectOverride) {
      return File(source.location).readAsStringSync();
    }

    return _effectiveBundle.loadString(source.location);
  }

  SkillSource resolveSkillSource(
    SkillId id, {
    required String skillsDir,
  }) {
    final overridePath = '$skillsDir/${id.value}.md';
    if (File(overridePath).existsSync()) {
      return SkillSource(
        type: SkillSourceType.projectOverride,
        location: overridePath,
      );
    }

    return SkillSource(
      type: SkillSourceType.bundledAsset,
      location: 'assets/skills/${id.value}.md',
    );
  }

  Future<String> loadPromptTemplate({
    required String agentId,
    required SkillId skill,
    required String projectRoot,
  }) async {
    final resolved = await _storage.resolve(projectRoot);
    final source = resolvePromptTemplateSource(
      agentId: agentId,
      skill: skill,
      templatesDir: resolved.promptTemplatesDir,
    );
    if (source.isProjectOverride) {
      return File(source.location).readAsStringSync();
    }

    return _effectiveBundle.loadString(source.location);
  }

  SkillSource resolvePromptTemplateSource({
    required String agentId,
    required SkillId skill,
    required String templatesDir,
  }) {
    final projectCandidates = [
      '$templatesDir/$agentId-${skill.value}.md.tmpl',
      '$templatesDir/$agentId.md.tmpl',
      '$templatesDir/default.md.tmpl',
    ];
    for (final path in projectCandidates) {
      if (File(path).existsSync()) {
        return SkillSource(
          type: SkillSourceType.projectOverride,
          location: path,
        );
      }
    }

    return SkillSource(
      type: SkillSourceType.bundledAsset,
      location: 'assets/prompts/$agentId-${skill.value}.md.tmpl',
    );
  }

  /// Loads an agent template.
  ///
  /// When [forClaude] is true, loads `CLAUDE.md.tmpl`;
  /// otherwise `AGENTS.md.tmpl`.
  Future<String> loadAgentTemplate({required bool forClaude}) async {
    final filename = forClaude ? 'CLAUDE.md.tmpl' : 'AGENTS.md.tmpl';
    return _effectiveBundle.loadString('assets/agents/$filename');
  }
}
