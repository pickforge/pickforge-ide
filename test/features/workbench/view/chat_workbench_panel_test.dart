import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';

class _MockRepo extends Mock implements ChatsRepository {}

void main() {
  testWidgets('renders empty placeholder when no chat is active',
      (tester) async {
    final repo = _MockRepo();
    when(() => repo.list(any())).thenAnswer((_) async => <ChatRow>[]);

    final cubit = ChatsCubit(repo);
    await cubit.syncProjects(['/p']);

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider.value(
          value: cubit,
          child: const Scaffold(body: ChatWorkbenchPanel()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Select or create a chat to begin'), findsOneWidget);
  });
}
