import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;

/// Thrown when `.pickforge/` exists but lacks Pickforge's `.gitignore` marker.
class PickforgeDirConflictException implements Exception {
  const PickforgeDirConflictException(this.message);

  final String message;

  @override
  String toString() => 'PickforgeDirConflictException: $message';
}

class WrittenContext {
  WrittenContext({
    required this.skillPath,
    required this.widgetContextPath,
    required this.initialPromptPath,
    this.widgetScreenshotPath,
    this.deviceScreenPath,
  });

  final String skillPath;
  final String widgetContextPath;
  final String? widgetScreenshotPath;
  final String? deviceScreenPath;
  final String initialPromptPath;
}

@lazySingleton
class PickforgeContextWriter {
  Future<WrittenContext> write({
    required String projectRoot,
    required String skillMarkdown,
    required String widgetContextMarkdown,
    required String initialPrompt,
    List<int>? widgetScreenshotPng,
    List<int>? deviceScreenPng,
  }) async {
    final dir = Directory(p.join(projectRoot, '.pickforge'));
    await _ensurePickforgeDir(dir);

    final skill = File(p.join(dir.path, 'skill-active.md'));
    final widget = File(p.join(dir.path, 'widget-context.md'));
    final initial = File(p.join(dir.path, 'initial-prompt.md'));

    await skill.writeAsString(skillMarkdown, flush: true);
    await widget.writeAsString(widgetContextMarkdown, flush: true);
    await initial.writeAsString(initialPrompt, flush: true);

    String? widgetShotPath;
    if (widgetScreenshotPng != null) {
      final f = File(p.join(dir.path, 'screenshot.png'));
      await f.writeAsBytes(widgetScreenshotPng, flush: true);
      widgetShotPath = f.path;
    }
    String? devicePath;
    if (deviceScreenPng != null) {
      final f = File(p.join(dir.path, 'device-screen.png'));
      await f.writeAsBytes(deviceScreenPng, flush: true);
      devicePath = f.path;
    }

    return WrittenContext(
      skillPath: skill.path,
      widgetContextPath: widget.path,
      initialPromptPath: initial.path,
      widgetScreenshotPath: widgetShotPath,
      deviceScreenPath: devicePath,
    );
  }

  Future<void> _ensurePickforgeDir(Directory dir) async {
    final gitignore = File(p.join(dir.path, '.gitignore'));
    if (dir.existsSync()) {
      if (gitignore.existsSync() && gitignore.readAsStringSync() == '*\n') {
        return;
      }
      throw const PickforgeDirConflictException(
        '.pickforge/ exists without Pickforge .gitignore marker. '
        'Remove or rename the directory and try again.',
      );
    }
    await dir.create(recursive: true);
    await gitignore.writeAsString('*\n', flush: true);
  }
}
