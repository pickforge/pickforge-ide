import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

/// What an Xcode / Swift iOS project root looks like to PickForge.
class IosProjectInfo extends Equatable {
  const IosProjectInfo({
    required this.projectRoot,
    this.workspace,
    this.xcodeproj,
    this.hasAppPackage = false,
  });

  /// `.xcworkspace` bundle name at the root, if any (preferred build input).
  final String? workspace;

  /// `.xcodeproj` bundle name at the root, if any.
  final String? xcodeproj;

  /// A `Package.swift` declaring an executable/app target.
  final bool hasAppPackage;

  final String projectRoot;

  /// A workspace or project is an unambiguous Xcode app project; a bare
  /// app-target SwiftPM package is a softer signal.
  bool get isExact => workspace != null || xcodeproj != null;

  @override
  List<Object?> get props => [projectRoot, workspace, xcodeproj, hasAppPackage];
}

/// Detects native iOS (Xcode / SwiftPM) projects from a project root.
///
/// Filesystem-only, so detection works on any OS; the adapter gates RUNTIME
/// features (build/simulator) behind macOS. Keying off a ROOT `.xcworkspace` /
/// `.xcodeproj` keeps Flutter (xcodeproj under `ios/`) and React Native
/// (package.json at root) projects from being misclassified.
class IosProjectDetector {
  const IosProjectDetector();

  // A Package.swift with an executable/app target (not a pure library).
  static final _appTarget =
      RegExp(r'executableTarget|\.executable\s*\(|\.iOSApplication\s*\(');

  Future<IosProjectInfo?> detect(String projectRoot) async {
    final root = Directory(projectRoot);
    if (!root.existsSync()) return null;

    String? workspace;
    String? xcodeproj;
    await for (final entity in root.list(followLinks: false)) {
      // `.xcworkspace` / `.xcodeproj` are bundle DIRECTORIES, not files.
      if (entity is! Directory) continue;
      final name = p.basename(entity.path);
      if (name.endsWith('.xcworkspace')) {
        workspace ??= name;
      } else if (name.endsWith('.xcodeproj')) {
        xcodeproj ??= name;
      }
    }

    final hasAppPackage = await _hasAppPackage(projectRoot);
    if (workspace == null && xcodeproj == null && !hasAppPackage) return null;

    return IosProjectInfo(
      projectRoot: projectRoot,
      workspace: workspace,
      xcodeproj: xcodeproj,
      hasAppPackage: hasAppPackage,
    );
  }

  Future<bool> _hasAppPackage(String projectRoot) async {
    final manifest = File(p.join(projectRoot, 'Package.swift'));
    if (!manifest.existsSync()) return false;
    try {
      if (await manifest.length() > 512 * 1024) return false;
      // Strip comments so `// .executableTarget` in a comment doesn't match.
      final content = (await manifest.readAsString())
          .replaceAll(RegExp(r'/\*.*?\*/', dotAll: true), '')
          .replaceAll(RegExp('//[^\n]*'), '');
      return _appTarget.hasMatch(content);
    } on FileSystemException {
      return false;
    }
  }
}
