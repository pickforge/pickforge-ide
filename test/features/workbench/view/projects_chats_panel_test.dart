// mocktail `when(() => x.method())` requires the wrapping closure.
// ignore_for_file: unnecessary_lambdas

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

class _MockChatsRepo extends Mock implements ChatsRepository {}

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
}) =>
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: MultiBlocProvider(
        providers: [
          BlocProvider.value(value: projectsCubit),
          BlocProvider.value(value: chatsCubit),
        ],
        child: const Scaffold(body: ProjectsChatsPanel()),
      ),
    );

void main() {
  testWidgets('renders projects header with empty state and "+" button',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => <ProjectRow>[]);
    final cRepo = _MockChatsRepo();

    final projectsCubit = ProjectsCubit(pRepo);
    final chatsCubit = ChatsCubit(cRepo);
    await projectsCubit.load();

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('PROJECTS'), findsOneWidget);
    expect(find.text('CHATS'), findsOneWidget);
    expect(find.text('Add your first project'), findsOneWidget);
  });

  testWidgets('selecting a project triggers cubit', (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list())
        .thenAnswer((_) async => [_project('/a'), _project('/b')]);
    when(() => pRepo.touch(any<String>())).thenAnswer((_) async {});

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list(any())).thenAnswer((_) async => <ChatRow>[]);

    final projectsCubit = ProjectsCubit(pRepo);
    final chatsCubit = ChatsCubit(cRepo);
    await projectsCubit.load();

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('a'), findsOneWidget);
    expect(find.text('b'), findsOneWidget);

    await tester.tap(find.text('b'));
    await tester.pumpAndSettle();

    verify(() => pRepo.touch('/b')).called(1);
  });

  testWidgets('chats list shows ChatRow titles', (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => [_project('/a')]);

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a'))
        .thenAnswer((_) async => [_chat('c1', '/a', 'Chat 1')]);

    final projectsCubit = ProjectsCubit(pRepo);
    final chatsCubit = ChatsCubit(cRepo);
    await projectsCubit.load();
    await chatsCubit.load('/a');

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('Chat 1'), findsOneWidget);
  });
}
