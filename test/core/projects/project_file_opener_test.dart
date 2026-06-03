import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';

void main() {
  test('uses xdg-open on linux', () async {
    final runner = _FakeRunner();
    final opener = ProjectFileOpener(
      runner: runner,
      operatingSystem: 'linux',
    );

    await opener.open('/tmp/file.dart');

    expect(runner.calls.single.$1, 'xdg-open');
    expect(runner.calls.single.$2, ['/tmp/file.dart']);
  });

  test('uses platform reveal command on macos', () async {
    final runner = _FakeRunner();
    final opener = ProjectFileOpener(
      runner: runner,
      operatingSystem: 'macos',
    );

    await opener.reveal('/tmp/file.dart');

    expect(runner.calls.single.$1, 'open');
    expect(runner.calls.single.$2, ['-R', '/tmp/file.dart']);
  });
}

class _FakeRunner implements ProcessRunner {
  final calls = <(String, List<String>)>[];

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    calls.add((executable, arguments));
    return ProcessResult(1, 0, '', '');
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}
