import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/projects/git_status_service.dart';

void main() {
  test('parse counts staged, unstaged, and untracked changes', () {
    final summary = GitStatusService(_FakeRunner())
        .parse('M  a.dart\n M b.dart\n?? c.dart\n', branchName: 'main');

    expect(summary.isDirty, isTrue);
    expect(summary.staged, 1);
    expect(summary.unstaged, 1);
    expect(summary.untracked, 1);
    expect(summary.branchName, 'main');
  });

  test('status captures current branch when available', () async {
    final summary = await GitStatusService(
      _FakeRunner(
        stdoutByArgs: {
          'status --porcelain=v1': ' M lib/main.dart\n',
          'rev-parse --abbrev-ref HEAD': 'feature/test\n',
        },
      ),
    ).status('/repo');

    expect(summary.isRepository, isTrue);
    expect(summary.unstaged, 1);
    expect(summary.branchName, 'feature/test');
  });

  test('status treats git errors as not a repository', () async {
    final summary = await GitStatusService(_FakeRunner(exitCode: 128)).status(
      '/not/repo',
    );

    expect(summary.isRepository, isFalse);
  });

  test('diffSummary parses changed files and stat', () async {
    final summary = await GitStatusService(
      _FakeRunner(
        stdoutByArgs: {
          'status --porcelain=v1': 'M  lib/a.dart\nR  old.dart -> lib/b.dart\n',
          'rev-parse --abbrev-ref HEAD': 'feature/test\n',
          'diff --stat HEAD': ' lib/a.dart | 2 ++\n lib/b.dart | 1 +\n',
        },
      ),
    ).diffSummary('/repo');

    expect(summary, isNotNull);
    expect(summary!.branchName, 'feature/test');
    expect(summary.changedFiles, ['lib/a.dart', 'lib/b.dart']);
    expect(summary.stat, contains('lib/a.dart'));
  });

  test('diff returns copyable diff text', () async {
    final diff = await GitStatusService(
      _FakeRunner(
        stdoutByArgs: {
          'diff HEAD --': 'diff --git a/lib/a.dart b/lib/a.dart\n',
        },
      ),
    ).diff('/repo');

    expect(diff, contains('diff --git'));
  });

  test('createCheckpointCommit commits tracked changes only', () async {
    final runner = _FakeRunner(
      stdoutByArgs: {
        'commit -m chore: pickforge checkpoint':
            '[main abc123] chore: pickforge checkpoint\n',
        'rev-parse --short HEAD': 'abc123\n',
      },
    );

    final result = await GitStatusService(runner).createCheckpointCommit(
      '/repo',
    );

    expect(result.created, isTrue);
    expect(result.commitHash, 'abc123');
    expect(runner.commands, [
      'add -u',
      'commit -m chore: pickforge checkpoint',
      'rev-parse --short HEAD',
    ]);
    expect(runner.cwds, everyElement('/repo'));
  });

  test('createCheckpointCommit returns failure when commit fails', () async {
    final runner = _FakeRunner(
      exitCodeByArgs: {
        'commit -m chore: pickforge checkpoint': 1,
      },
      stderrByArgs: {
        'commit -m chore: pickforge checkpoint': 'nothing to commit',
      },
    );

    final result = await GitStatusService(runner).createCheckpointCommit(
      '/repo',
    );

    expect(result.created, isFalse);
    expect(result.output, contains('nothing to commit'));
    expect(runner.commands, [
      'add -u',
      'commit -m chore: pickforge checkpoint',
    ]);
  });
}

class _FakeRunner implements ProcessRunner {
  _FakeRunner({
    this.exitCode = 0,
    this.stdoutByArgs = const {},
    this.stderrByArgs = const {},
    this.exitCodeByArgs = const {},
  });

  final int exitCode;
  final Map<String, String> stdoutByArgs;
  final Map<String, String> stderrByArgs;
  final Map<String, int> exitCodeByArgs;
  final commands = <String>[];
  final cwds = <String?>[];

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    final key = arguments.join(' ');
    commands.add(key);
    cwds.add(cwd);
    return ProcessResult(
      1,
      exitCodeByArgs[key] ?? exitCode,
      stdoutByArgs[key] ?? '',
      stderrByArgs[key] ?? '',
    );
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
