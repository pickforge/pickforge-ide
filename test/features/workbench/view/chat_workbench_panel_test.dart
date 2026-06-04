// mocktail wrapping closures.
// ignore_for_file: unnecessary_lambdas

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/headless/codex_exec_json_adapter.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter_registry.dart';
import 'package:pickforge/core/agent/headless/headless_chat_feature_flags.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session_pool.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockRepo extends Mock implements ChatsRepository {}

class _MockDao extends Mock implements ProjectSettingsDao {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

class _NeverRunner implements ProcessRunner {
  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
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
  setUp(() => getIt.reset());

  tearDown(() => getIt.reset());

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
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
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

  testWidgets('renders headless chat pane when codex flag is enabled',
      (tester) async {
    getIt
      ..registerSingleton<HeadlessChatFeatureFlags>(
        const HeadlessChatFeatureFlags(
          enabledByAgent: {AgentProfileId.codex: true},
        ),
      )
      ..registerSingleton<HeadlessChatSessionPool>(
        HeadlessChatSessionPool(
          _NeverRunner(),
          HeadlessChatAdapterRegistry([const CodexExecJsonAdapter()]),
        ),
      );

    final repo = _MockRepo();
    when(() => repo.list('/p'))
        .thenAnswer((_) async => [_chat('chat-1', '/p')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId('/p')).thenAnswer((_) async => 'chat-1');
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});
    final chatsCubit = ChatsCubit(repo, settings);
    await chatsCubit.syncProjects(['/p'], defaultExpand: '/p');

    final projectsRepo = _MockProjectsRepo();
    when(() => projectsRepo.list()).thenAnswer((_) async => [_project('/p')]);
    final projectsCubit = ProjectsCubit(projectsRepo, PtySessionPool());
    await projectsCubit.load();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
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

    expect(find.text('Headless adapter'), findsOneWidget);
    expect(find.text('No messages yet'), findsOneWidget);
    expect(find.byTooltip('Send'), findsOneWidget);
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
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
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
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
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
