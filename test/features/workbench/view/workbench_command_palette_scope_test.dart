import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/view/workbench_command_palette_scope.dart';
import 'package:pickforge/shared/command_palette/command.dart';
import 'package:pickforge/shared/command_palette/command_palette.dart';

class _ProjectsCubit extends Mock implements ProjectsCubit {}

class _ChatsCubit extends Mock implements ChatsCubit {}

class _EmulatorCubit extends Mock implements EmulatorSessionCubit {}

void main() {
  testWidgets('workbench palette delegates quick actions', (tester) async {
    final projects = _ProjectsCubit();
    final chats = _ChatsCubit();
    final emulator = _EmulatorCubit();
    var picked = false;

    _stubProjects(projects);
    _stubChats(chats);
    _stubEmulator(
      emulator,
      EmulatorSessionState.running(
        vmServiceUri: 'ws://x/ws',
        stats: RunStats(),
        avd: const Avd(id: 'Pixel_10', name: 'Pixel 10', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );
    when(
      () => chats.newChat(
        projectRoot: '/p',
        defaultAgentId: 'claude-code',
      ),
    ).thenAnswer((_) async => 'chat-1');
    when(() => projects.add('/picked')).thenAnswer((_) async {});
    when(emulator.hotReload).thenAnswer((_) async {});

    await tester.pumpWidget(
      _Harness(
        projects: projects,
        chats: chats,
        emulator: emulator,
        pickFolder: () async {
          picked = true;
          return '/picked';
        },
      ),
    );

    await _openPalette(tester);

    for (final title in [
      'New Chat',
      'Add Project',
      'Hot Reload',
      'Pick Device',
      'Open Settings',
    ]) {
      await _filterPalette(tester, title);
      expect(_commandTile(title), findsOneWidget);
    }

    await _filterPalette(tester, 'New Chat');
    await tester.tap(_commandTile('New Chat'));
    await tester.pumpAndSettle();

    verify(
      () => chats.newChat(
        projectRoot: '/p',
        defaultAgentId: 'claude-code',
      ),
    ).called(1);

    await _openPalette(tester);
    await _filterPalette(tester, 'Hot Reload');
    await tester.tap(_commandTile('Hot Reload'));
    await tester.pumpAndSettle();

    verify(emulator.hotReload).called(1);

    await _openPalette(tester);
    await _filterPalette(tester, 'Add Project');
    await tester.tap(_commandTile('Add Project'));
    await tester.pumpAndSettle();

    expect(picked, isTrue);
    verify(() => projects.add('/picked')).called(1);
  });

  testWidgets('workbench shortcuts dispatch quick actions', (tester) async {
    final projects = _ProjectsCubit();
    final chats = _ChatsCubit();
    final emulator = _EmulatorCubit();

    _stubProjects(projects);
    _stubChats(chats);
    _stubEmulator(
      emulator,
      EmulatorSessionState.running(
        vmServiceUri: 'ws://x/ws',
        stats: RunStats(),
        avd: const Avd(id: 'Pixel_10', name: 'Pixel 10', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );
    when(
      () => chats.newChat(
        projectRoot: '/p',
        defaultAgentId: 'claude-code',
      ),
    ).thenAnswer((_) async => 'chat-1');
    when(() => projects.add('/picked')).thenAnswer((_) async {});
    when(emulator.hotReload).thenAnswer((_) async {});

    await tester.pumpWidget(
      _Harness(
        projects: projects,
        chats: chats,
        emulator: emulator,
        pickFolder: () async => '/picked',
      ),
    );

    await _sendControlShortcut(tester, LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();
    await _sendControlShortcut(tester, LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    await _sendControlShortcut(tester, LogicalKeyboardKey.keyO);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.f5);
    await tester.pumpAndSettle();

    verify(
      () => chats.newChat(
        projectRoot: '/p',
        defaultAgentId: 'claude-code',
      ),
    ).called(1);
    verify(emulator.hotReload).called(2);
    verify(() => projects.add('/picked')).called(1);
  });

  testWidgets('workbench palette runs app from idle state', (tester) async {
    final projects = _ProjectsCubit();
    final chats = _ChatsCubit();
    final emulator = _EmulatorCubit();

    _stubProjects(projects);
    _stubChats(chats);
    _stubEmulator(
      emulator,
      const EmulatorSessionState.idle(
        avd: Avd(id: 'Pixel_10', name: 'Pixel 10', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );
    when(emulator.runApp).thenAnswer((_) async {});

    await tester.pumpWidget(
      _Harness(projects: projects, chats: chats, emulator: emulator),
    );

    await _openPalette(tester);

    await _filterPalette(tester, 'Run App');
    expect(_commandTile('Run App'), findsOneWidget);
    await _filterPalette(tester, 'Hot Reload');
    expect(_commandTile('Hot Reload'), findsNothing);

    await _filterPalette(tester, 'Run App');
    await tester.tap(_commandTile('Run App'));
    await tester.pumpAndSettle();

    verify(emulator.runApp).called(1);
  });

  testWidgets('workbench run shortcut starts idle app', (tester) async {
    final projects = _ProjectsCubit();
    final chats = _ChatsCubit();
    final emulator = _EmulatorCubit();

    _stubProjects(projects);
    _stubChats(chats);
    _stubEmulator(
      emulator,
      const EmulatorSessionState.idle(
        avd: Avd(id: 'Pixel_10', name: 'Pixel 10', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );
    when(emulator.runApp).thenAnswer((_) async {});

    await tester.pumpWidget(
      _Harness(projects: projects, chats: chats, emulator: emulator),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.f5);
    await tester.pumpAndSettle();

    verify(emulator.runApp).called(1);
  });

  testWidgets('workbench palette surfaces transcript search results',
      (tester) async {
    final projects = _ProjectsCubit();
    final chats = _ChatsCubit();
    final emulator = _EmulatorCubit();
    var ran = false;
    _stubProjects(projects);
    _stubChats(chats);
    _stubEmulator(emulator, const EmulatorSessionState.noDevicePicked());

    await tester.pumpWidget(
      _Harness(
        projects: projects,
        chats: chats,
        emulator: emulator,
        searchCommands: (query) async => [
          PickforgeCommand(
            id: 'search-transcript-chat-1',
            title: 'Transcript: Auth cleanup',
            hint: 'Found "$query"',
            run: () => ran = true,
          ),
        ],
      ),
    );

    await _sendControlShortcut(tester, LogicalKeyboardKey.keyK);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(find.byType(TextField), 'disabled state');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Transcript: Auth cleanup'), findsOneWidget);
    await tester.tap(find.widgetWithText(ListTile, 'Transcript: Auth cleanup'));
    await tester.pump();

    expect(ran, isTrue);
  });
}

void _stubProjects(_ProjectsCubit cubit, [ProjectRow? project]) {
  final row = project ??
      ProjectRow(
        projectRoot: '/p',
        displayName: 'Project',
        createdAt: DateTime(2026, 6, 3),
        lastOpenedAt: DateTime(2026, 6, 3),
        sortOrder: 0,
      );
  final state =
      ProjectsReady(projects: [row], activeProjectRoot: row.projectRoot);
  when(() => cubit.state).thenReturn(state);
  when(() => cubit.stream).thenAnswer((_) => const Stream.empty());
}

void _stubChats(_ChatsCubit cubit, [ChatRow? chat]) {
  final state = ChatsReady(
    chatsByProject: {
      chat?.projectRoot ?? '/p': [
        if (chat != null) chat,
      ],
    },
    expanded: {chat?.projectRoot ?? '/p'},
  );
  when(() => cubit.state).thenReturn(state);
  when(() => cubit.stream).thenAnswer((_) => const Stream.empty());
}

void _stubEmulator(
  _EmulatorCubit cubit,
  EmulatorSessionState state,
) {
  when(() => cubit.state).thenReturn(state);
  when(() => cubit.stream).thenAnswer((_) => const Stream.empty());
}

Future<void> _openPalette(WidgetTester tester) async {
  await tester.tap(find.widgetWithText(ElevatedButton, 'Open'));
  await tester.pumpAndSettle();
}

Future<void> _filterPalette(WidgetTester tester, String query) async {
  await tester.enterText(find.byType(TextField), query);
  await tester.pumpAndSettle();
}

Future<void> _sendControlShortcut(
  WidgetTester tester,
  LogicalKeyboardKey key,
) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
}

Finder _commandTile(String title) => find.widgetWithText(ListTile, title);

class _Harness extends StatelessWidget {
  const _Harness({
    required this.projects,
    required this.chats,
    required this.emulator,
    this.pickFolder,
    this.searchCommands,
  });

  final ProjectsCubit projects;
  final ChatsCubit chats;
  final EmulatorSessionCubit emulator;
  final Future<String?> Function()? pickFolder;
  final Future<List<PickforgeCommand>> Function(String query)? searchCommands;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: MultiBlocProvider(
        providers: [
          BlocProvider<ProjectsCubit>.value(value: projects),
          BlocProvider<ChatsCubit>.value(value: chats),
          BlocProvider<EmulatorSessionCubit>.value(value: emulator),
        ],
        child: WorkbenchCommandPaletteScope(
          pickFolder: pickFolder ?? (() async => null),
          searchCommands: searchCommands,
          child: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () => unawaited(
                  showDialog<void>(
                    context: context,
                    builder: (_) => CommandPalette(
                      commands: buildWorkbenchCommands(
                        context,
                        pickFolder: pickFolder ?? (() async => null),
                      ),
                    ),
                  ),
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
