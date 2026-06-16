import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/search/workspace_search_service.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

void main() {
  late PickforgeDatabase db;
  late Directory tmp;
  late String projectRoot;
  late String chatId;

  setUp(() async {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    await db.customStatement('PRAGMA foreign_keys = ON;');
    tmp = await Directory.systemTemp.createTemp('pickforge_search_test_');
    projectRoot = tmp.path;
    await db.projectsDao.upsert(
      projectRoot: projectRoot,
      displayName: 'Search App',
      now: DateTime(2026, 6, 4, 10),
    );
    chatId = await db.chatsDao.insert(
      projectRoot: projectRoot,
      title: 'Auth cleanup',
      agentId: 'codex',
      now: DateTime(2026, 6, 4, 11),
    );
    await db.chatsDao.setTaskStatus(chatId, ChatTaskStatus.waiting);
    await db.chatsDao.setTaskBrief(chatId, 'Release readiness checks');
    await db.chatsDao.setLabels(chatId, ['release', 'ui']);
    await db.pickHistoryDao.insertPick(
      projectRoot: projectRoot,
      widgetClass: 'ElevatedButton',
      creationFile: 'lib/features/auth/sign_in_screen.dart',
      creationLine: 150,
      skillId: 'edit-widget',
      agentId: 'codex',
      terminalId: 'terminal',
      chatId: chatId,
      widgetContextJson: '{"source":"Sign In Button"}',
    );
    File(p.join(projectRoot, '.pickforge', '.gitignore'))
      ..parent.createSync(recursive: true)
      ..writeAsStringSync('*\n');
    final transcript = File(
      p.join(projectRoot, '.pickforge', 'chats', chatId, 'transcript.log'),
    );
    await transcript.parent.create(recursive: true);
    await transcript.writeAsString(
      'The sign in form needs better \x1B[33mdisabled state\x1B[0m copy.',
    );
  });

  tearDown(() async {
    await db.close();
    if (tmp.existsSync()) await tmp.delete(recursive: true);
  });

  test('search returns chat, pick history, and transcript matches', () async {
    final search =
        WorkspaceSearchService(db, ContextStorageService.forTesting());

    final chatResults = await search.search('auth cleanup');
    expect(
      chatResults.where((r) => r.kind == WorkspaceSearchResultKind.chat),
      isNotEmpty,
    );

    final historyResults = await search.search('elv btn');
    expect(
      historyResults
          .where((r) => r.kind == WorkspaceSearchResultKind.pickHistory)
          .single
          .title,
      'Pick History: ElevatedButton',
    );

    final transcriptResults = await search.search('disabled state');
    final transcript = transcriptResults
        .where((r) => r.kind == WorkspaceSearchResultKind.transcript)
        .single;
    expect(transcript.chatId, chatId);
    expect(transcript.subtitle, contains('disabled state'));
    expect(transcript.subtitle, isNot(contains('\x1B')));

    final labelResults = await search.search('release readiness');
    final chat = labelResults
        .where((r) => r.kind == WorkspaceSearchResultKind.chat)
        .single;
    expect(chat.subtitle, contains('Waiting'));
    expect(chat.subtitle, contains('release'));
  });

  test('search reads transcripts from the resolved home chats dir', () async {
    final home = await Directory.systemTemp.createTemp('pf-home-search-');
    addTearDown(() => home.delete(recursive: true));
    final storage = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': home.path},
      isWindows: false,
    );
    final resolved = await storage.resolve(projectRoot);
    final transcript = File(
      p.join(resolved.chatsDir, chatId, 'transcript.log'),
    );
    await transcript.parent.create(recursive: true);
    await transcript.writeAsString('home-mode transcript marker copy.');

    final search = WorkspaceSearchService(db, storage);
    final results = await search.search('home-mode transcript');
    final match = results
        .where((r) => r.kind == WorkspaceSearchResultKind.transcript)
        .single;
    expect(match.chatId, chatId);
    expect(match.subtitle, contains('home-mode transcript'));
  });
}
