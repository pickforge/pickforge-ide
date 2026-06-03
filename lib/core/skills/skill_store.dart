import 'dart:io';

import 'package:flutter/services.dart';
import 'package:pickforge/core/skills/models.dart';

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
/// Prefers project-local overrides in `.pickforge/skills/` before falling back
/// to bundled assets in `assets/skills/`.
///
/// Not annotated with `@lazySingleton` — wired via `@module` in injection.dart.
class SkillStore {
  SkillStore([AssetBundle? bundle]) : _bundle = bundle;

  final AssetBundle? _bundle;

  AssetBundle get _effectiveBundle => _bundle ?? rootBundle;

  /// Loads a skill by [id], preferring a project-local override at
  /// `.pickforge/skills/{id.value}.md`, falling back to the bundled asset.
  Future<String> loadSkill(
    SkillId id, {
    required String projectRoot,
  }) async {
    final source = resolveSkillSource(id, projectRoot: projectRoot);
    if (source.isProjectOverride) {
      return File(source.location).readAsStringSync();
    }

    return _effectiveBundle.loadString(source.location);
  }

  SkillSource resolveSkillSource(
    SkillId id, {
    required String projectRoot,
  }) {
    final overridePath = '$projectRoot/.pickforge/skills/${id.value}.md';
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

  /// Loads an agent template.
  ///
  /// When [forClaude] is true, loads `CLAUDE.md.tmpl`;
  /// otherwise `AGENTS.md.tmpl`.
  Future<String> loadAgentTemplate({required bool forClaude}) async {
    final filename = forClaude ? 'CLAUDE.md.tmpl' : 'AGENTS.md.tmpl';
    return _effectiveBundle.loadString('assets/agents/$filename');
  }
}
