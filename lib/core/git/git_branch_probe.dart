import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';

class GitBranchInfo extends Equatable {
  const GitBranchInfo({required this.branch, required this.isWorktree});

  final String branch;
  final bool isWorktree;

  @override
  List<Object?> get props => [branch, isWorktree];
}

/// Reads the current branch (and whether the checkout is a linked worktree)
/// for a project root. Returns null outside a git repository.
class GitBranchProbe {
  const GitBranchProbe(this._runner);

  final ProcessRunner _runner;

  Future<GitBranchInfo?> probe(String projectRoot) async {
    try {
      final head = await _runner.run(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        cwd: projectRoot,
      );
      if (head.exitCode != 0) return null;
      final branch = head.stdout.toString().trim();
      if (branch.isEmpty) return null;

      final gitDir = await _runner.run(
        'git',
        ['rev-parse', '--git-dir', '--git-common-dir'],
        cwd: projectRoot,
      );
      var isWorktree = false;
      if (gitDir.exitCode == 0) {
        final lines = gitDir.stdout.toString().trim().split('\n');
        if (lines.length >= 2) {
          isWorktree = p.normalize(lines[0]) != p.normalize(lines[1]);
        }
      }
      return GitBranchInfo(branch: branch, isWorktree: isWorktree);
    } on Object {
      return null;
    }
  }
}
