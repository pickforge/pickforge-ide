import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/search/search_matcher.dart';

enum WorkspaceSearchResultKind { chat, pickHistory, transcript }

class WorkspaceSearchResult {
  const WorkspaceSearchResult({
    required this.kind,
    required this.title,
    required this.subtitle,
    required this.projectRoot,
    this.chatId,
  });

  final WorkspaceSearchResultKind kind;
  final String title;
  final String subtitle;
  final String projectRoot;
  final String? chatId;
}

class WorkspaceSearchService {
  WorkspaceSearchService(this._db);

  static const _maxHistoryRows = 100;
  static const int _maxTranscriptBytes = 256 * 1024;

  final PickforgeDatabase _db;

  Future<List<WorkspaceSearchResult>> search(
    String query, {
    int limit = 20,
  }) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];

    final projects = {
      for (final project in await _db.projectsDao.allOrderedByLastOpened())
        project.projectRoot: project.displayName,
    };
    final chats = await _db.chatsDao.all();
    final results = <WorkspaceSearchResult>[];

    for (final chat in chats) {
      if (!SearchMatcher.matches(trimmed, [
        chat.title,
        chat.agentId,
        chat.skillId,
        projects[chat.projectRoot],
        chat.projectRoot,
      ])) {
        continue;
      }
      results.add(
        WorkspaceSearchResult(
          kind: WorkspaceSearchResultKind.chat,
          title: 'Chat: ${chat.title}',
          subtitle: _chatSubtitle(chat, projects),
          projectRoot: chat.projectRoot,
          chatId: chat.chatId,
        ),
      );
    }

    final history = await _db.pickHistoryDao.recentRows(
      limit: _maxHistoryRows,
    );
    for (final row in history) {
      if (!SearchMatcher.matches(trimmed, [
        row.widgetClass,
        row.creationFile,
        row.skillId,
        row.agentId,
        row.projectRoot,
        row.widgetContextJson,
      ])) {
        continue;
      }
      final location = row.creationFile == null
          ? row.projectRoot
          : '${row.creationFile}:${row.creationLine ?? '?'}';
      results.add(
        WorkspaceSearchResult(
          kind: WorkspaceSearchResultKind.pickHistory,
          title: 'Pick History: ${row.widgetClass}',
          subtitle: location,
          projectRoot: row.projectRoot,
          chatId: row.chatId,
        ),
      );
    }

    for (final chat in chats) {
      final match = _transcriptMatch(chat, trimmed);
      if (match == null) continue;
      results.add(
        WorkspaceSearchResult(
          kind: WorkspaceSearchResultKind.transcript,
          title: 'Transcript: ${chat.title}',
          subtitle: match,
          projectRoot: chat.projectRoot,
          chatId: chat.chatId,
        ),
      );
    }

    return results.take(limit).toList(growable: false);
  }

  String? _transcriptMatch(ChatRow chat, String query) {
    final file = File(
      p.join(
        chat.projectRoot,
        '.pickforge',
        'chats',
        chat.chatId,
        'transcript.log',
      ),
    );
    final content = _tryReadTail(file)?.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (content == null) return null;
    if (content.isEmpty) return null;
    final lower = content.toLowerCase();
    final queryLower = query.toLowerCase();
    final index = lower.indexOf(queryLower);
    if (index == -1 && !SearchMatcher.matches(query, [content])) return null;
    final start = index <= 24 ? 0 : index - 24;
    final end = (start + 120).clamp(0, content.length);
    final prefix = start == 0 ? '' : '...';
    final suffix = end == content.length ? '' : '...';
    return '$prefix${content.substring(start, end)}$suffix';
  }

  String _chatSubtitle(ChatRow chat, Map<String, String> projects) {
    final project = projects[chat.projectRoot] ?? p.basename(chat.projectRoot);
    return '$project - ${chat.agentId}';
  }

  String? _tryReadTail(File file) {
    if (!file.existsSync()) return null;
    try {
      return _readTail(file);
    } on FileSystemException {
      return null;
    }
  }

  String _readTail(File file) {
    final length = file.lengthSync();
    final start =
        length > _maxTranscriptBytes ? length - _maxTranscriptBytes : 0;
    final raf = file.openSync();
    try {
      raf.setPositionSync(start);
      return utf8.decode(
        raf.readSync(length - start),
        allowMalformed: true,
      );
    } finally {
      raf.closeSync();
    }
  }
}
