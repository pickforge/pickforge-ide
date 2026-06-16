import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/web/web_project_detector.dart';

/// The JavaScript package manager driving a web project, inferred from its
/// lockfile.
enum WebPackageManager { pnpm, yarn, npm, bun }

/// A resolved web dev-server process invocation.
class WebCommand extends Equatable {
  const WebCommand({
    required this.executable,
    required this.arguments,
    required this.cwd,
  });

  final String executable;
  final List<String> arguments;
  final String cwd;

  @override
  List<Object?> get props => [executable, arguments, cwd];
}

/// Builds the command that starts a web project's dev server through its own
/// package-manager script (`<pm> run <script>`), so the project's toolchain
/// (Vite, Next, etc.) is respected rather than guessed.
class WebCommandBuilder {
  const WebCommandBuilder();

  /// Runs the detected dev/start script; defaults to `dev` when the project
  /// info carries no script (e.g. a framework-only project).
  WebCommand devServer({required WebProjectInfo project, String? script}) {
    final runScript = script ?? project.devScript ?? 'dev';
    return WebCommand(
      executable: _executable(detectPackageManager(project.projectRoot)),
      arguments: ['run', runScript],
      cwd: project.projectRoot,
    );
  }

  /// Lockfile precedence pnpm > yarn > npm > bun; defaults to npm.
  WebPackageManager detectPackageManager(String projectRoot) {
    bool has(String name) => File(p.join(projectRoot, name)).existsSync();
    if (has('pnpm-lock.yaml')) return WebPackageManager.pnpm;
    if (has('yarn.lock')) return WebPackageManager.yarn;
    if (has('package-lock.json')) return WebPackageManager.npm;
    if (has('bun.lockb') || has('bun.lock')) return WebPackageManager.bun;
    return WebPackageManager.npm;
  }

  String _executable(WebPackageManager pm) {
    switch (pm) {
      case WebPackageManager.npm:
        return 'npm';
      case WebPackageManager.yarn:
        return 'yarn';
      case WebPackageManager.pnpm:
        return 'pnpm';
      case WebPackageManager.bun:
        return 'bun';
    }
  }
}
