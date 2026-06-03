// mocktail `when(() => x.method())` requires the wrapping closure.
// ignore_for_file: unnecessary_lambdas

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/main.dart' show shouldSyncChatsForProjects;

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

class _MockChatsRepo extends Mock implements ChatsRepository {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

class _FakeSidebarSettingsRepository
    implements WorkspaceSidebarSettingsRepository {
  WorkspaceSidebarSettings settings = WorkspaceSidebarSettings.defaults;

  @override
  Future<WorkspaceSidebarSettings> load() async => settings;

  @override
  Future<void> save(WorkspaceSidebarSettings settings) async {
    this.settings = settings;
  }
}

ProjectRow _project(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

ChatRow _chat(String id, String project, String title) => ChatRow(
      chatId: id,
      projectRoot: project,
      title: title,
      agentId: 'codex',
      createdAt: DateTime(2026, 4, 25),
      lastActivityAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

Widget _harness({
  required ProjectsCubit projectsCubit,
  required ChatsCubit chatsCubit,
  WorkspaceSidebarCubit? sidebarCubit,
  bool withProjectSyncListener = false,
}) {
  final sidebar =
      sidebarCubit ?? WorkspaceSidebarCubit(_FakeSidebarSettingsRepository());
  return MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: MultiBlocProvider(
      providers: [
        BlocProvider.value(value: projectsCubit),
        BlocProvider.value(value: chatsCubit),
        BlocProvider.value(value: sidebar),
      ],
      child: Builder(
        builder: (context) {
          const panel = Scaffold(body: ProjectsChatsPanel());
          if (!withProjectSyncListener) return panel;
          return BlocListener<ProjectsCubit, ProjectsState>(
            listenWhen: shouldSyncChatsForProjects,
            listener: (context, state) {
              if (state is! ProjectsReady) return;
              unawaited(
                context.read<ChatsCubit>().syncProjects(
                      state.projects.map((p) => p.projectRoot).toList(),
                      defaultExpand: state.activeProjectRoot,
                    ),
              );
            },
            child: panel,
          );
        },
      ),
    ),
  );
}

void main() {
  testWidgets('renders projects header with empty state and "+" button',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => <ProjectRow>[]);
    final cRepo = _MockChatsRepo();
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('PROJECTS'), findsOneWidget);
    expect(find.text('Add your first project'), findsOneWidget);
  });

  testWidgets('tapping a project toggles expand and shows nested chats',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => [_project('/a')]);
    when(() => pRepo.touch(any<String>())).thenAnswer((_) async {});

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a'))
        .thenAnswer((_) async => [_chat('c1', '/a', 'Chat 1')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a']);
    chatsCubit.toggleExpanded('/a');

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('a'), findsOneWidget);
    expect(find.text('Chat 1'), findsOneWidget);
  });

  testWidgets('chat tap waits for project switch before selecting chat',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer(
      (_) async => [_project('/a'), _project('/b')],
    );
    final touchCompleter = Completer<void>();
    when(() => pRepo.touch('/b')).thenAnswer((_) => touchCompleter.future);

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a')).thenAnswer((_) async => <ChatRow>[]);
    when(() => cRepo.list('/b'))
        .thenAnswer((_) async => [_chat('c-b', '/b', 'Chat B')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a', '/b']);
    chatsCubit.toggleExpanded('/b');

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Chat B'));
    await tester.pump();

    verifyNever(() => settings.setLastChatId('/b', 'c-b'));

    touchCompleter.complete();
    await tester.pumpAndSettle();

    verify(() => settings.setLastChatId('/b', 'c-b')).called(1);
  });

  testWidgets('app sync listener skips active-project-only chat taps',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer(
      (_) async => [_project('/a'), _project('/b')],
    );
    when(() => pRepo.touch('/b')).thenAnswer((_) async {});

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a'))
        .thenAnswer((_) async => [_chat('c-a', '/a', 'Chat A')]);
    when(() => cRepo.list('/b'))
        .thenAnswer((_) async => [_chat('c-b', '/b', 'Chat B')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a', '/b']);
    chatsCubit.toggleExpanded('/b');
    clearInteractions(cRepo);

    await tester.pumpWidget(
      _harness(
        projectsCubit: projectsCubit,
        chatsCubit: chatsCubit,
        withProjectSyncListener: true,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Chat B'));
    await tester.pumpAndSettle();

    verifyNever(() => cRepo.list('/a'));
    verifyNever(() => cRepo.list('/b'));
    expect((chatsCubit.state as ChatsReady).activeChatId, 'c-b');
  });
}
