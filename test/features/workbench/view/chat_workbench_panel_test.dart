// mocktail wrapping closures.
// ignore_for_file: unnecessary_lambdas

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';

class _MockRepo extends Mock implements ChatsRepository {}

class _MockDao extends Mock implements ProjectSettingsDao {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

ProjectRow _project(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

ChatRow _chat(String id, String root) => ChatRow(
      chatId: id,
      projectRoot: root,
      title: id,
      agentId: 'codex',
      createdAt: DateTime(2026, 4, 25),
      lastActivityAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  testWidgets('renders empty placeholder when no chat is active',
      (tester) async {
    final repo = _MockRepo();
    when(() => repo.list(any())).thenAnswer((_) async => <ChatRow>[]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);

    final cubit = ChatsCubit(repo, settings);
    await cubit.syncProjects(['/p']);
    final projectsCubit = ProjectsCubit(_MockProjectsRepo(), PtySessionPool());

    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider.value(value: projectsCubit),
            BlocProvider.value(value: cubit),
            BlocProvider(create: (_) => RunLogsCubit()),
            BlocProvider(create: (_) => WorkbenchLayoutCubit(_MockDao())),
          ],
          child: const Scaffold(body: ChatWorkbenchPanel()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Select or create a chat to begin'), findsOneWidget);
  });

  testWidgets('shows run logs pane when expanded', (tester) async {
    final repo = _MockRepo();
    when(() => repo.list(any())).thenAnswer((_) async => <ChatRow>[]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);

    final cubit = ChatsCubit(repo, settings);
    await cubit.syncProjects(['/p']);
    final projectsCubit = ProjectsCubit(_MockProjectsRepo(), PtySessionPool());
    final layout = WorkbenchLayoutCubit(_MockDao())..toggleRunLogs();

    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider.value(value: projectsCubit),
            BlocProvider.value(value: cubit),
            BlocProvider(create: (_) => RunLogsCubit()),
            BlocProvider.value(value: layout),
          ],
          child: const Scaffold(body: ChatWorkbenchPanel()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No run logs yet'), findsOneWidget);
  });

  testWidgets('hides active chat from a different project', (tester) async {
    final repo = _MockRepo();
    when(() => repo.list('/a'))
        .thenAnswer((_) async => [_chat('a-chat', '/a')]);
    when(() => repo.list('/b')).thenAnswer((_) async => <ChatRow>[]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});
    final chatsCubit = ChatsCubit(repo, settings);
    await chatsCubit.syncProjects(['/a', '/b']);
    await chatsCubit.selectChat('a-chat');

    final projectsRepo = _MockProjectsRepo();
    when(() => projectsRepo.list())
        .thenAnswer((_) async => [_project('/a'), _project('/b')]);
    when(() => projectsRepo.touch('/b')).thenAnswer((_) async {});
    final projectsCubit = ProjectsCubit(projectsRepo, PtySessionPool());
    await projectsCubit.load();
    await projectsCubit.selectProject('/b');

    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider.value(value: projectsCubit),
            BlocProvider.value(value: chatsCubit),
            BlocProvider(create: (_) => RunLogsCubit()),
            BlocProvider(create: (_) => WorkbenchLayoutCubit(_MockDao())),
          ],
          child: const Scaffold(body: ChatWorkbenchPanel()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Select or create a chat to begin'), findsOneWidget);
  });
}
