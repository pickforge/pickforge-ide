import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/web/web_command_builder.dart';
import 'package:pickforge/core/targets/web/web_project_detector.dart';

Future<Directory> _project({String? lockfile}) async {
  final dir = await Directory.systemTemp.createTemp('web_cmd');
  if (lockfile != null) {
    await File(p.join(dir.path, lockfile)).writeAsString('x\n');
  }
  return dir;
}

void main() {
  const builder = WebCommandBuilder();

  test('runs the detected dev script through the package manager', () async {
    final dir = await _project(lockfile: 'pnpm-lock.yaml');
    addTearDown(() => dir.delete(recursive: true));
    final project = WebProjectInfo(
      projectRoot: dir.path,
      hasWebFramework: true,
      devScript: 'dev',
    );
    final command = builder.devServer(project: project);
    expect(command.executable, 'pnpm');
    expect(command.arguments, ['run', 'dev']);
    expect(command.cwd, dir.path);
  });

  test('honors the start script and an explicit override', () async {
    final dir = await _project(lockfile: 'yarn.lock');
    addTearDown(() => dir.delete(recursive: true));
    final project = WebProjectInfo(
      projectRoot: dir.path,
      hasWebFramework: false,
      devScript: 'start',
    );
    expect(builder.devServer(project: project).arguments, ['run', 'start']);
    expect(
      builder.devServer(project: project, script: 'preview').arguments,
      ['run', 'preview'],
    );
  });

  test('defaults to the dev script when none is recorded', () async {
    final dir = await _project();
    addTearDown(() => dir.delete(recursive: true));
    final project =
        WebProjectInfo(projectRoot: dir.path, hasWebFramework: true);
    expect(builder.devServer(project: project).arguments, ['run', 'dev']);
    // No lockfile → npm default.
    expect(builder.devServer(project: project).executable, 'npm');
  });

  test('infers package manager by lockfile precedence', () async {
    Future<WebPackageManager> pm(List<String> lockfiles) async {
      final dir = await Directory.systemTemp.createTemp('web_pm');
      addTearDown(() => dir.delete(recursive: true));
      for (final f in lockfiles) {
        await File(p.join(dir.path, f)).writeAsString('x\n');
      }
      return builder.detectPackageManager(dir.path);
    }

    expect(await pm(['pnpm-lock.yaml', 'yarn.lock']), WebPackageManager.pnpm);
    expect(
      await pm(['yarn.lock', 'package-lock.json']),
      WebPackageManager.yarn,
    );
    expect(await pm(['package-lock.json']), WebPackageManager.npm);
    expect(await pm(['bun.lock']), WebPackageManager.bun);
    expect(await pm([]), WebPackageManager.npm);
  });
}
