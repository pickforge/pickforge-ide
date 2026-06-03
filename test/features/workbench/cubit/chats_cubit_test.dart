import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';

class _MockRepo extends Mock implements ChatsRepository {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

ChatRow _row(String id, String project, String title) => ChatRow(
      chatId: id,
      projectRoot: project,
      title: title,
      agentId: 'codex',
      createdAt: DateTime(2026, 4, 25),
      lastActivityAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  late _MockRepo repo;
  late _MockSettings settings;

  setUp(() {
    repo = _MockRepo();
    settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});
  });

  blocTest<ChatsCubit, ChatsState>(
    'syncProjects emits Loading then Ready with chats grouped by project',
    setUp: () {
      when(() => repo.list('/p'))
          .thenAnswer((_) async => [_row('c1', '/p', 'Chat 1')]);
      when(() => repo.list('/q')).thenAnswer((_) async => <ChatRow>[]);
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) => c.syncProjects(['/p', '/q'], defaultExpand: '/p'),
    expect: () => [
      isA<ChatsLoading>(),
      isA<ChatsReady>()
          .having((s) => s.chatsByProject.keys.toList(), 'roots', ['/p', '/q'])
          .having((s) => s.chatsByProject['/p']!.length, 'p count', 1)
          .having((s) => s.expanded.contains('/p'), 'p expanded', true),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'newChat inserts and selects the new chat under its project',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer((_) async => <ChatRow>[]);
      when(
        () => repo.newChat(
          projectRoot: '/p',
          defaultAgentId: 'codex',
          skillId: any(named: 'skillId'),
        ),
      ).thenAnswer((_) async => 'c-new');
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) async {
      await c.syncProjects(['/p']);
      when(() => repo.list('/p'))
          .thenAnswer((_) async => [_row('c-new', '/p', 'Chat 1')]);
      await c.newChat(projectRoot: '/p', defaultAgentId: 'codex');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>()
          .having((s) => s.activeChatId, 'active', 'c-new')
          .having((s) => s.chatsByProject['/p']!.length, 'count', 1)
          .having((s) => s.expanded.contains('/p'), 'expanded', true),
    ],
    verify: (_) {
      verify(() => settings.setLastChatId('/p', 'c-new')).called(1);
    },
  );

  blocTest<ChatsCubit, ChatsState>(
    'selectChat updates active without reloading',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer(
        (_) async => [_row('c1', '/p', 'Chat 1'), _row('c2', '/p', 'Chat 2')],
      );
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) async {
      await c.syncProjects(['/p']);
      await c.selectChat('c2');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'c2'),
    ],
    verify: (_) {
      verify(() => settings.setLastChatId('/p', 'c2')).called(1);
    },
  );

  blocTest<ChatsCubit, ChatsState>(
    'syncProjects restores saved active chat for active project',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer(
        (_) async => [_row('c1', '/p', 'Chat 1'), _row('c2', '/p', 'Chat 2')],
      );
      when(() => settings.getLastChatId('/p')).thenAnswer((_) async => 'c2');
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) => c.syncProjects(['/p'], defaultExpand: '/p'),
    expect: () => [
      isA<ChatsLoading>(),
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'c2'),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'syncProjects switches active chat when active project changes',
    setUp: () {
      when(() => repo.list('/a'))
          .thenAnswer((_) async => [_row('a-chat', '/a', 'Chat A')]);
      when(() => repo.list('/b'))
          .thenAnswer((_) async => [_row('b-chat', '/b', 'Chat B')]);
      when(() => settings.getLastChatId('/a'))
          .thenAnswer((_) async => 'a-chat');
      when(() => settings.getLastChatId('/b'))
          .thenAnswer((_) async => 'b-chat');
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) async {
      await c.syncProjects(['/a', '/b'], defaultExpand: '/a');
      await c.syncProjects(['/a', '/b'], defaultExpand: '/b');
    },
    expect: () => [
      isA<ChatsLoading>(),
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'a-chat'),
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'b-chat'),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'activateProject restores saved chat or clears incompatible active chat',
    setUp: () {
      when(() => repo.list('/a'))
          .thenAnswer((_) async => [_row('a-chat', '/a', 'Chat A')]);
      when(() => repo.list('/b')).thenAnswer((_) async => <ChatRow>[]);
      when(() => settings.getLastChatId('/a'))
          .thenAnswer((_) async => 'a-chat');
      when(() => settings.getLastChatId('/b')).thenAnswer((_) async => null);
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) async {
      await c.syncProjects(['/a', '/b']);
      await c.activateProject('/a');
      await c.activateProject('/b');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'a-chat'),
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', null),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'toggleExpanded flips the expanded set for a project',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer((_) async => <ChatRow>[]);
    },
    build: () => ChatsCubit(repo, settings),
    act: (c) async {
      await c.syncProjects(['/p']);
      c.toggleExpanded('/p');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>().having(
        (s) => s.expanded.contains('/p'),
        'expanded',
        true,
      ),
    ],
  );
}
