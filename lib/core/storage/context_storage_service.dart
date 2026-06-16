import 'dart:io';

// meta is a transitive dependency of the Flutter SDK; this infra file must not
// pull in Flutter just to reach @visibleForTesting.
// ignore: depend_on_referenced_packages
import 'package:meta/meta.dart';
import 'package:path/path.dart' as p;

import 'package:pickforge/core/projects/pickforge_project_directory.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/pickforge_home.dart';
import 'package:pickforge/core/storage/project_id.dart';
import 'package:pickforge/core/storage/resolved_context_directory.dart';

/// Resolves where a project's context artifacts live.
///
/// The per-project override is read through a lazy `settingsProvider` closure
/// rather than an injected repository so that constructing this service (e.g.
/// by an eager DI singleton at startup) never forces the Drift database — and
/// its `path_provider` lookup — to be built. The database is only touched when
/// `resolve` runs, by which point the app is fully initialised.
class ContextStorageService {
  ContextStorageService({
    ProjectSettingsRepository Function()? settingsProvider,
  }) : _settingsProvider = settingsProvider;

  @visibleForTesting
  ContextStorageService.forTesting({
    Map<String, String>? environment,
    bool? isWindows,
    ProjectSettingsRepository? settings,
  })  : _environment = environment,
        _isWindows = isWindows,
        _settingsProvider = settings == null ? null : (() => settings);

  Map<String, String>? _environment;
  bool? _isWindows;
  final ProjectSettingsRepository Function()? _settingsProvider;

  Future<ResolvedContextDirectory> resolve(
    String projectRoot, {
    ContextStorageLocation? location,
  }) async {
    // Absolutize the root up front so resolved paths, the project id, and the
    // `PICKFORGE_*` env / prompt values they feed are always absolute, even for
    // a relative input. `.absolute.path` (not `p.canonicalize`) keeps symlinks.
    final absoluteRoot = Directory(projectRoot).absolute.path;
    final effective =
        location ?? await _effectiveLocation(projectRoot, absoluteRoot);
    final id = ProjectId.forRoot(absoluteRoot);

    final String contextDir;
    final String runsDir;
    final String chatsDir;

    switch (effective.mode) {
      case ContextStorageMode.projectLocal:
        final base = p.join(absoluteRoot, '.pickforge');
        contextDir = base;
        runsDir = p.join(base, 'runs');
        chatsDir = p.join(base, 'chats');
      case ContextStorageMode.pickforgeHome:
        final base = p.join(
          PickforgeHome.resolve(
            environment: _environment,
            isWindows: _isWindows,
          ),
          'projects',
          id,
        );
        contextDir = p.join(base, 'context');
        runsDir = p.join(base, 'runs');
        chatsDir = p.join(base, 'chats');
      case ContextStorageMode.customPath:
        final base = p.join(
          Directory(effective.customPath!).absolute.path,
          'projects',
          id,
        );
        contextDir = p.join(base, 'context');
        runsDir = p.join(base, 'runs');
        chatsDir = p.join(base, 'chats');
    }

    return ResolvedContextDirectory(
      projectRoot: absoluteRoot,
      projectId: id,
      storageLocation: effective,
      contextDir: contextDir,
      runsDir: runsDir,
      chatsDir: chatsDir,
      isProjectLocal: effective.mode == ContextStorageMode.projectLocal,
    );
  }

  /// Resolution precedence when no explicit `location` is passed:
  /// persisted per-project override (when a settings repository is wired) wins
  /// over auto-detect of an existing project-local `.pickforge/` marker.
  Future<ContextStorageLocation> _effectiveLocation(
    String projectRoot,
    String absoluteRoot,
  ) async {
    final settings = _settingsProvider?.call();
    if (settings != null) {
      try {
        final override = await settings.getContextStorageLocation(projectRoot);
        if (override != null) return override;
      } on Object {
        // A failed preference read must not break context resolution, which
        // every writer depends on — fall back to the auto-detected default.
      }
    }
    return _autoDetect(absoluteRoot);
  }

  ContextStorageLocation _autoDetect(String projectRoot) {
    final marker = File(p.join(projectRoot, '.pickforge', '.gitignore'));
    if (marker.existsSync() && marker.readAsStringSync() == '*\n') {
      return const ContextStorageLocation.projectLocal();
    }
    return const ContextStorageLocation.pickforgeHome();
  }

  Future<ResolvedContextDirectory> ensure(
    String projectRoot, {
    ContextStorageLocation? location,
  }) async {
    if (!Directory(projectRoot).existsSync()) {
      throw PickforgeDirConflictException(
        'Project folder does not exist: $projectRoot',
      );
    }

    final resolved = await resolve(projectRoot, location: location);

    if (resolved.isProjectLocal) {
      await PickforgeProjectDirectory.ensure(projectRoot);
    } else {
      for (final path in [
        resolved.contextDir,
        resolved.runsDir,
        resolved.chatsDir,
      ]) {
        final dir = Directory(path);
        if (!dir.existsSync()) {
          await dir.create(recursive: true);
        }
      }
    }

    return resolved;
  }
}
