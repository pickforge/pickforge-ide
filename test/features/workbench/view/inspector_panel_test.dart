import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/history/pick_history_recorder.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/forge/forge.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockCubit extends Mock implements WidgetPickerCubit {}

class _MockProjectsCubit extends Mock implements ProjectsCubit {}

class _MockChatsCubit extends Mock implements ChatsCubit {}

class _MockForgeCubit extends Mock implements ForgeCubit {}

const _sampleWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w1',
    className: 'Text',
    children: [],
    creationLocation: CreationLocation(
      file: '/tmp/test/lib/main.dart',
      line: 1,
      column: 1,
    ),
  ),
  ancestorClasses: ['MaterialApp'],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

ProjectRow _project(String root) => ProjectRow(
      projectRoot: root,
      displayName: 'test',
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

ChatRow _chat(String id, String projectRoot) => ChatRow(
      chatId: id,
      projectRoot: projectRoot,
      title: 'Chat 1',
      agentId: 'claude-code',
      createdAt: DateTime(2026, 4, 25),
      lastActivityAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  testWidgets('renders disconnected pill and placeholder when no selection',
      (tester) async {
    final cubit = _MockCubit();
    final state = WidgetPickerState.initial();
    when(() => cubit.state).thenReturn(state);
    when(() => cubit.stream).thenAnswer((_) => Stream.fromIterable([state]));

    final projectsCubit = _MockProjectsCubit();
    const projectsState = ProjectsReady(projects: []);
    when(() => projectsCubit.state).thenReturn(projectsState);
    when(() => projectsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([projectsState]));

    final chatsCubit = _MockChatsCubit();
    const chatsState = ChatsReady(chatsByProject: {}, expanded: {});
    when(() => chatsCubit.state).thenReturn(chatsState);
    when(() => chatsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([chatsState]));

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MultiBlocProvider(
          providers: [
            BlocProvider<ProjectsCubit>.value(value: projectsCubit),
            BlocProvider<ChatsCubit>.value(value: chatsCubit),
          ],
          child: Scaffold(body: InspectorPanel(cubit: cubit)),
        ),
      ),
    );

    expect(find.text('Pick device'), findsOneWidget);
    expect(find.text('No widget selected'), findsOneWidget);
  });

  testWidgets('renders widget details and ForgePanel for active chat',
      (tester) async {
    final cubit = _MockCubit();
    const pickerState = WidgetPickerState(
      selection: _sampleWidget,
      selectModeEnabled: true,
      latestRebuildStats: RebuildStats(
        frameNumber: 3,
        startTime: 1000,
        widgets: [
          RebuiltWidget(
            className: 'CounterText',
            location: CreationLocation(
              file: '/tmp/test/lib/main.dart',
              line: 1,
              column: 1,
            ),
            count: 4,
          ),
        ],
      ),
    );
    when(() => cubit.state).thenReturn(pickerState);
    when(() => cubit.stream)
        .thenAnswer((_) => Stream.fromIterable([pickerState]));

    final projectsCubit = _MockProjectsCubit();
    final projectsState = ProjectsReady(
      projects: [_project('/tmp/test')],
      activeProjectRoot: '/tmp/test',
    );
    when(() => projectsCubit.state).thenReturn(projectsState);
    when(() => projectsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([projectsState]));

    final chatsCubit = _MockChatsCubit();
    final chatsState = ChatsReady(
      chatsByProject: {
        '/tmp/test': [_chat('chat-1', '/tmp/test')],
      },
      expanded: const {'/tmp/test'},
      activeChatId: 'chat-1',
    );
    when(() => chatsCubit.state).thenReturn(chatsState);
    when(() => chatsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([chatsState]));

    final forgeCubit = _MockForgeCubit();
    when(() => forgeCubit.state).thenReturn(ForgeState.initial());
    when(() => forgeCubit.stream).thenAnswer((_) => const Stream.empty());

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MultiBlocProvider(
          providers: [
            BlocProvider<ProjectsCubit>.value(value: projectsCubit),
            BlocProvider<ChatsCubit>.value(value: chatsCubit),
            BlocProvider<ForgeCubit>.value(value: forgeCubit),
          ],
          child: Scaffold(body: InspectorPanel(cubit: cubit)),
        ),
      ),
    );

    expect(find.text('Text'), findsOneWidget);
    expect(find.text('CounterText'), findsOneWidget);
    expect(find.text('Recent rebuilds'), findsOneWidget);
    expect(find.text('x4'), findsOneWidget);
    expect(find.text('Forge it'), findsOneWidget);
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNotNull);
  });

  testWidgets('disables ForgePanel when active chat belongs to another project',
      (tester) async {
    final cubit = _MockCubit();
    const pickerState = WidgetPickerState(
      selection: _sampleWidget,
      selectModeEnabled: true,
      latestRebuildStats: null,
    );
    when(() => cubit.state).thenReturn(pickerState);
    when(() => cubit.stream)
        .thenAnswer((_) => Stream.fromIterable([pickerState]));

    final projectsCubit = _MockProjectsCubit();
    final projectsState = ProjectsReady(
      projects: [_project('/tmp/test'), _project('/tmp/other')],
      activeProjectRoot: '/tmp/test',
    );
    when(() => projectsCubit.state).thenReturn(projectsState);
    when(() => projectsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([projectsState]));

    final chatsCubit = _MockChatsCubit();
    final chatsState = ChatsReady(
      chatsByProject: {
        '/tmp/other': [_chat('other-chat', '/tmp/other')],
      },
      expanded: const {'/tmp/other'},
      activeChatId: 'other-chat',
    );
    when(() => chatsCubit.state).thenReturn(chatsState);
    when(() => chatsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([chatsState]));

    final forgeCubit = _MockForgeCubit();
    when(() => forgeCubit.state).thenReturn(ForgeState.initial());
    when(() => forgeCubit.stream).thenAnswer((_) => const Stream.empty());

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MultiBlocProvider(
          providers: [
            BlocProvider<ProjectsCubit>.value(value: projectsCubit),
            BlocProvider<ChatsCubit>.value(value: chatsCubit),
            BlocProvider<ForgeCubit>.value(value: forgeCubit),
          ],
          child: Scaffold(body: InspectorPanel(cubit: cubit)),
        ),
      ),
    );

    expect(find.text('Forge it'), findsOneWidget);
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('records pick history when selected widget changes',
      (tester) async {
    final db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    addTearDown(db.close);
    final pickerStream = StreamController<WidgetPickerState>.broadcast();
    addTearDown(pickerStream.close);

    final cubit = _MockCubit();
    when(() => cubit.state).thenReturn(WidgetPickerState.initial());
    when(() => cubit.stream).thenAnswer((_) => pickerStream.stream);

    final projectsCubit = _MockProjectsCubit();
    final projectsState = ProjectsReady(
      projects: [_project('/tmp/test')],
      activeProjectRoot: '/tmp/test',
    );
    when(() => projectsCubit.state).thenReturn(projectsState);
    when(() => projectsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([projectsState]));

    final chatsCubit = _MockChatsCubit();
    final chatsState = ChatsReady(
      chatsByProject: {
        '/tmp/test': [_chat('chat-1', '/tmp/test')],
      },
      expanded: const {'/tmp/test'},
      activeChatId: 'chat-1',
    );
    when(() => chatsCubit.state).thenReturn(chatsState);
    when(() => chatsCubit.stream)
        .thenAnswer((_) => Stream.fromIterable([chatsState]));

    final forgeCubit = _MockForgeCubit();
    when(() => forgeCubit.state).thenReturn(ForgeState.initial());
    when(() => forgeCubit.stream).thenAnswer((_) => const Stream.empty());

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MultiBlocProvider(
          providers: [
            BlocProvider<ProjectsCubit>.value(value: projectsCubit),
            BlocProvider<ChatsCubit>.value(value: chatsCubit),
            BlocProvider<ForgeCubit>.value(value: forgeCubit),
          ],
          child: Scaffold(
            body: InspectorPanel(
              cubit: cubit,
              historyRecorder: PickHistoryRecorder(db.pickHistoryDao),
            ),
          ),
        ),
      ),
    );

    pickerStream.add(
      const WidgetPickerState(
        selection: _sampleWidget,
        selectModeEnabled: true,
        latestRebuildStats: null,
      ),
    );
    await tester.pump();

    var rows = <PickHistoryRow>[];
    for (var i = 0; i < 20 && rows.isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 20));
      rows = await db.select(db.pickHistory).get();
    }

    expect(rows, hasLength(1));
    expect(rows.single.widgetClass, 'Text');
    expect(rows.single.projectRoot, '/tmp/test');
    expect(rows.single.chatId, 'chat-1');
  });
}
