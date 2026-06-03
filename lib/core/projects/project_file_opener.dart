import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';

class ProjectFileOpener {
  ProjectFileOpener({
    required ProcessRunner runner,
    String? operatingSystem,
  })  : _runner = runner,
        _operatingSystem = operatingSystem ?? Platform.operatingSystem;

  final ProcessRunner _runner;
  final String _operatingSystem;

  Future<void> open(String path) async {
    final command = _openCommand(path);
    await _runner.run(command.executable, command.arguments);
  }

  Future<void> reveal(String path) async {
    final command = _revealCommand(path);
    await _runner.run(command.executable, command.arguments);
  }

  _Command _openCommand(String path) {
    return switch (_operatingSystem) {
      'macos' => _Command('open', [path]),
      'windows' => _Command('cmd', ['/c', 'start', '', path]),
      _ => _Command('xdg-open', [path]),
    };
  }

  _Command _revealCommand(String path) {
    return switch (_operatingSystem) {
      'macos' => _Command('open', ['-R', path]),
      'windows' => _Command('explorer.exe', ['/select,', path]),
      _ => _Command('xdg-open', [
          if (FileSystemEntity.isDirectorySync(path)) path else p.dirname(path),
        ]),
    };
  }
}

class _Command {
  const _Command(this.executable, this.arguments);

  final String executable;
  final List<String> arguments;
}
