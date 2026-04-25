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
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/view/app_shell_view.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockDao extends Mock implements ProjectSettingsDao {}

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

class _MockChatsRepo extends Mock implements ChatsRepository {}

class _MockWidgetPickerCubit extends Mock implements WidgetPickerCubit {}

void main() {
  testWidgets('renders three panes inside MultiSplitView', (tester) async {
    tester.view.physicalSize = const Size(1400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final dao = _MockDao();
    when(() => dao.paneSizes(any())).thenAnswer((_) async => null);

    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => <ProjectRow>[]);

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list(any())).thenAnswer((_) async => <ChatRow>[]);

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
              BlocProvider.value(value: ProjectsCubit(pRepo)),
              BlocProvider.value(value: ChatsCubit(cRepo)),
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
  });
}
