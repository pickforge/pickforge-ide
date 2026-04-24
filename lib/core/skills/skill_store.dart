import 'dart:io';

import 'package:flutter/services.dart';
import 'package:pickforge/core/skills/models.dart';

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
    final overridePath = '$projectRoot/.pickforge/skills/${id.value}.md';
    final overrideFile = File(overridePath);

    if (overrideFile.existsSync()) {
      return overrideFile.readAsStringSync();
    }

    return _effectiveBundle.loadString('assets/skills/${id.value}.md');
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
