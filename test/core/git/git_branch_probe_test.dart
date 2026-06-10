import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/git/git_branch_probe.dart';

class _FakeRunner implements ProcessRunner {
  _FakeRunner(this.responses);

  final Map<String, ProcessResult> responses;

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    final key = arguments.join(' ');
    return responses[key] ?? ProcessResult(0, 128, '', 'not a git repo');
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) =>
      throw UnimplementedError();
}

void main() {
  test('reports the current branch of a normal checkout', () async {
    final probe = GitBranchProbe(
      _FakeRunner({
        'rev-parse --abbrev-ref HEAD': ProcessResult(0, 0, 'main\n', ''),
        'rev-parse --git-dir --git-common-dir':
            ProcessResult(0, 0, '.git\n.git\n', ''),
      }),
    );

    final info = await probe.probe('/repo');

    expect(info, const GitBranchInfo(branch: 'main', isWorktree: false));
  });

  test('flags a linked worktree', () async {
    final probe = GitBranchProbe(
      _FakeRunner({
        'rev-parse --abbrev-ref HEAD': ProcessResult(0, 0, 'feature-x\n', ''),
        'rev-parse --git-dir --git-common-dir': ProcessResult(
          0,
          0,
          '/repo/.git/worktrees/feature-x\n/repo/.git\n',
          '',
        ),
      }),
    );

    final info = await probe.probe('/repo-feature-x');

    expect(info, const GitBranchInfo(branch: 'feature-x', isWorktree: true));
  });

  test('returns null outside a git repository', () async {
    final probe = GitBranchProbe(_FakeRunner({}));

    expect(await probe.probe('/not-a-repo'), isNull);
  });
}
