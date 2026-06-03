import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

class RunHistoryView extends StatelessWidget {
  const RunHistoryView({super.key, this.historyStream, this.projectRoot});

  final Stream<List<RunSessionLogRow>>? historyStream;
  final String? projectRoot;

  @override
  Widget build(BuildContext context) {
    final root = projectRoot ?? _activeProjectRoot(context);
    final stream = historyStream ?? _historyStreamFor(root);
    return Scaffold(
      appBar: AppBar(title: const Text('Run History')),
      body: root == null && historyStream == null
          ? const Center(child: Text('Select a project to view run history'))
          : StreamBuilder<List<RunSessionLogRow>>(
              stream: stream,
              initialData: const [],
              builder: (context, snapshot) {
                final rows = snapshot.data ?? const <RunSessionLogRow>[];
                if (rows.isEmpty) {
                  return const Center(child: Text('No run sessions recorded'));
                }
                return ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, index) =>
                      _RunHistoryTile(row: rows[index]),
                );
              },
            ),
    );
  }

  String? _activeProjectRoot(BuildContext context) {
    try {
      return switch (context.read<ProjectsCubit>().state) {
        ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
        _ => null,
      };
    } on ProviderNotFoundException {
      return null;
    }
  }

  Stream<List<RunSessionLogRow>> _historyStreamFor(String? root) {
    if (root == null || !getIt.isRegistered<RunSessionLogRepository>()) {
      return Stream.value(const <RunSessionLogRow>[]);
    }
    return getIt<RunSessionLogRepository>().watchRecent(root);
  }
}

class _RunHistoryTile extends StatelessWidget {
  const _RunHistoryTile({required this.row});

  final RunSessionLogRow row;

  @override
  Widget build(BuildContext context) {
    final title = row.avdName ?? row.serial ?? row.connectionMode;
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        title: Text(title, overflow: TextOverflow.ellipsis),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Project: ${row.projectRoot}'),
              Text('Session: ${row.sessionId}'),
              Text('Started: ${_formatDate(row.startedAt)}'),
              Text('Ended: ${_formatNullableDate(row.endedAt)}'),
              Text('Target: ${row.targetFile ?? 'default'}'),
              Text('VM Service: ${row.vmServiceUrl ?? 'none'}'),
              Text('Exit: ${row.exitReason ?? 'running'}'),
              Text('Exit code: ${row.exitCode?.toString() ?? 'none'}'),
              Text('Hot reloads: ${row.hotReloadCount}'),
              Text('Hot restarts: ${row.hotRestartCount}'),
              Text('Errors: ${row.errorCount}'),
              if (row.lastError != null) Text('Last error: ${row.lastError}'),
            ],
          ),
        ),
      ),
    );
  }

  String _formatNullableDate(DateTime? value) {
    if (value == null) return 'running';
    return _formatDate(value);
  }

  String _formatDate(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }
}
