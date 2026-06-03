import 'package:flutter/material.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

class HistoryView extends StatelessWidget {
  const HistoryView({super.key, this.historyStream});

  final Stream<List<PickHistoryRow>>? historyStream;

  @override
  Widget build(BuildContext context) {
    final stream = historyStream ?? _historyStreamOrEmpty();
    return Scaffold(
      appBar: AppBar(title: const Text('Pick History')),
      body: StreamBuilder<List<PickHistoryRow>>(
        stream: stream,
        initialData: const [],
        builder: (context, snapshot) {
          final rows = snapshot.data ?? const <PickHistoryRow>[];
          if (rows.isEmpty) {
            return const Center(child: Text('No picks recorded yet'));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) => _HistoryTile(row: rows[index]),
          );
        },
      ),
    );
  }

  Stream<List<PickHistoryRow>> _historyStreamOrEmpty() {
    if (!getIt.isRegistered<PickforgeDatabase>()) {
      return Stream.value(const <PickHistoryRow>[]);
    }
    return getIt<PickforgeDatabase>().pickHistoryDao.recent();
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.row});

  final PickHistoryRow row;

  @override
  Widget build(BuildContext context) {
    final location = row.creationFile == null
        ? null
        : '${row.creationFile}:${row.creationLine ?? '?'}';
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        title: Text(row.widgetClass, overflow: TextOverflow.ellipsis),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Project: ${row.projectRoot}'),
              if (location != null) Text('Location: $location'),
              Text('Skill: ${row.skillId}'),
              Text('Agent: ${row.agentId}'),
              Text('Picked: ${_formatPickedAt(row.pickedAt)}'),
              Text('Chat: ${row.chatId ?? 'none'}'),
            ],
          ),
        ),
      ),
    );
  }

  String _formatPickedAt(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }
}
