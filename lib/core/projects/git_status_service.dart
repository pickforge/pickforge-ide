import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class GitStatusSummary extends Equatable {
  const GitStatusSummary({
    required this.isRepository,
    required this.staged,
    required this.unstaged,
    required this.untracked,
    this.branchName,
  });

  const GitStatusSummary.notRepository()
      : isRepository = false,
        staged = 0,
        unstaged = 0,
        untracked = 0,
        branchName = null;

  final bool isRepository;
  final int staged;
  final int unstaged;
  final int untracked;
  final String? branchName;

  bool get isDirty => staged > 0 || unstaged > 0 || untracked > 0;

  @override
  List<Object?> get props => [
        isRepository,
        staged,
        unstaged,
        untracked,
        branchName,
      ];
}

class GitDiffSummary extends Equatable {
  const GitDiffSummary({
    required this.branchName,
    required this.changedFiles,
    required this.stat,
  });

  final String? branchName;
  final List<String> changedFiles;
  final String stat;

  bool get hasChanges => changedFiles.isNotEmpty || stat.trim().isNotEmpty;

  @override
  List<Object?> get props => [branchName, changedFiles, stat];
}

class GitCheckpointResult extends Equatable {
  const GitCheckpointResult({
    required this.created,
    this.commitHash,
    this.output = '',
  });

  final bool created;
  final String? commitHash;
  final String output;

  @override
  List<Object?> get props => [created, commitHash, output];
}

class GitStatusService {
  GitStatusService(this._runner);

  final ProcessRunner _runner;

  Future<GitStatusSummary> status(String projectRoot) async {
    final ProcessResult result;
    try {
      result = await _runner.run(
        'git',
        ['status', '--porcelain=v1'],
        cwd: projectRoot,
      );
    } on ProcessRunnerException {
      return const GitStatusSummary.notRepository();
    }
    if (result.exitCode != 0) return const GitStatusSummary.notRepository();
    final branchName = await _branchName(projectRoot);
    return parse(result.stdout.toString(), branchName: branchName);
  }

  GitStatusSummary parse(String porcelain, {String? branchName}) {
    var staged = 0;
    var unstaged = 0;
    var untracked = 0;
    for (final line in porcelain.split('\n')) {
      if (line.trim().isEmpty) continue;
      if (line.startsWith('??')) {
        untracked++;
        continue;
      }
      if (line.isNotEmpty && line[0] != ' ') staged++;
      if (line.length > 1 && line[1] != ' ') unstaged++;
    }
    return GitStatusSummary(
      isRepository: true,
      staged: staged,
      unstaged: unstaged,
      untracked: untracked,
      branchName: branchName,
    );
  }

  Future<GitDiffSummary?> diffSummary(String projectRoot) async {
    final statusResult = await _runGit(
      ['status', '--porcelain=v1'],
      projectRoot,
    );
    if (statusResult == null || statusResult.exitCode != 0) return null;
    final statResult = await _runGit(['diff', '--stat', 'HEAD'], projectRoot);
    final branchName = await _branchName(projectRoot);
    return GitDiffSummary(
      branchName: branchName,
      changedFiles: parseChangedFiles(statusResult.stdout.toString()),
      stat: statResult?.stdout.toString().trimRight() ?? '',
    );
  }

  Future<String?> diff(String projectRoot) async {
    final result = await _runGit(['diff', 'HEAD', '--'], projectRoot);
    if (result == null || result.exitCode != 0) return null;
    return result.stdout.toString();
  }

  Future<GitCheckpointResult> createCheckpointCommit(
    String projectRoot, {
    String message = 'chore: pickforge checkpoint',
  }) async {
    final addResult = await _runGit(['add', '-u'], projectRoot);
    if (addResult == null || addResult.exitCode != 0) {
      return GitCheckpointResult(
        created: false,
        output: _combinedOutput(addResult),
      );
    }
    final commitResult = await _runGit(['commit', '-m', message], projectRoot);
    if (commitResult == null || commitResult.exitCode != 0) {
      return GitCheckpointResult(
        created: false,
        output: _combinedOutput(commitResult),
      );
    }
    final hashResult = await _runGit(
      ['rev-parse', '--short', 'HEAD'],
      projectRoot,
    );
    final hash =
        hashResult?.exitCode == 0 ? hashResult?.stdout.toString().trim() : null;
    return GitCheckpointResult(
      created: true,
      commitHash: hash == null || hash.isEmpty ? null : hash,
      output: _combinedOutput(commitResult),
    );
  }

  List<String> parseChangedFiles(String porcelain) {
    final files = <String>[];
    for (final line in porcelain.split('\n')) {
      if (line.length < 4) continue;
      final raw = line.substring(3).trim();
      if (raw.isEmpty) continue;
      final renamed = raw.split(' -> ');
      files.add(renamed.last);
    }
    return files;
  }

  Future<String?> _branchName(String projectRoot) async {
    try {
      final result = await _runner.run(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        cwd: projectRoot,
      );
      if (result.exitCode != 0) return null;
      final branch = result.stdout.toString().trim();
      return branch.isEmpty ? null : branch;
    } on ProcessRunnerException {
      return null;
    }
  }

  Future<ProcessResult?> _runGit(
    List<String> arguments,
    String projectRoot,
  ) async {
    try {
      return await _runner.run('git', arguments, cwd: projectRoot);
    } on ProcessRunnerException {
      return null;
    }
  }

  String _combinedOutput(ProcessResult? result) {
    if (result == null) return '';
    return [
      result.stdout.toString().trim(),
      result.stderr.toString().trim(),
    ].where((part) => part.isNotEmpty).join('\n');
  }
}
