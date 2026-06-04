// mocktail wrapping closures.
// ignore_for_file: unnecessary_lambdas

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/view/app_shell_view.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MockDao extends Mock implements ProjectSettingsDao {}

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

class _MockChatsRepo extends Mock implements ChatsRepository {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

class _MockWidgetPickerCubit extends Mock implements WidgetPickerCubit {}

void main() {
  testWidgets('renders three panes inside MultiSplitView', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await getIt.reset();
    addTearDown(getIt.reset);
    final prefs = await SharedPreferences.getInstance();
    getIt.registerFactory<WorkspaceSidebarCubit>(
      () => WorkspaceSidebarCubit(WorkspaceSidebarSettingsRepository(prefs)),
    );

    tester.view.physicalSize = const Size(1400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final dao = _MockDao();
    when(() => dao.paneSizes(any())).thenAnswer((_) async => null);

    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => <ProjectRow>[]);

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list(any())).thenAnswer((_) async => <ChatRow>[]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);

    final picker = _MockWidgetPickerCubit();
    final pickerState = WidgetPickerState.initial();
    when(() => picker.state).thenReturn(pickerState);
    when(() => picker.stream)
        .thenAnswer((_) => Stream.fromIterable([pickerState]));

    final layoutCubit = WorkbenchLayoutCubit(dao);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: MultiBlocProvider(
            providers: [
              BlocProvider.value(value: layoutCubit),
              BlocProvider.value(value: ProjectsCubit(pRepo, PtySessionPool())),
              BlocProvider.value(value: ChatsCubit(cRepo, settings)),
              BlocProvider<WidgetPickerCubit>.value(value: picker),
            ],
            child: const AppShellView(),
          ),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.byKey(const Key('workbench-left')), findsOneWidget);
    expect(find.byKey(const Key('workbench-middle')), findsOneWidget);
    expect(find.byKey(const Key('workbench-right')), findsOneWidget);

    final focusedColor = Theme.of(tester.element(find.byType(AppShellView)))
        .colorScheme
        .secondary;
    expect(
      _paneBorderColor(tester, const Key('workbench-left-focus-frame')),
      Colors.transparent,
    );

    await _sendControlShiftShortcut(tester, LogicalKeyboardKey.keyE);
    await tester.pump();

    expect(
      _paneBorderColor(tester, const Key('workbench-left-focus-frame')),
      focusedColor,
    );

    await _sendControlShortcut(tester, LogicalKeyboardKey.backquote);
    await tester.pump();

    expect(
      _paneBorderColor(tester, const Key('workbench-middle-focus-frame')),
      focusedColor,
    );
  });
}

Color _paneBorderColor(WidgetTester tester, Key key) {
  final box = tester.widget<DecoratedBox>(find.byKey(key));
  final decoration = box.decoration as BoxDecoration;
  final border = decoration.border;
  if (border is! Border) fail('Expected pane focus frame to use Border.');
  return border.top.color;
}

Future<void> _sendControlShiftShortcut(
  WidgetTester tester,
  LogicalKeyboardKey key,
) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
}

Future<void> _sendControlShortcut(
  WidgetTester tester,
  LogicalKeyboardKey key,
) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
}
