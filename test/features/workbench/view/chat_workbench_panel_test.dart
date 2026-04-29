import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';

class _MockRepo extends Mock implements ChatsRepository {}

class _MockDao extends Mock implements ProjectSettingsDao {}

void main() {
  testWidgets('renders empty placeholder when no chat is active',
      (tester) async {
    final repo = _MockRepo();
    when(() => repo.list(any())).thenAnswer((_) async => <ChatRow>[]);

    final cubit = ChatsCubit(repo);
    await cubit.syncProjects(['/p']);

    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
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

    final cubit = ChatsCubit(repo);
    await cubit.syncProjects(['/p']);
    final layout = WorkbenchLayoutCubit(_MockDao())..toggleRunLogs();

    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
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
}
