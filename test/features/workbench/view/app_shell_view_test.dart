import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/view/app_shell_view.dart';

class _MockDao extends Mock implements ProjectSettingsDao {}

void main() {
  testWidgets('renders three panes inside MultiSplitView', (tester) async {
    tester.view.physicalSize = const Size(1400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final dao = _MockDao();
    when(() => dao.paneSizes(any())).thenAnswer((_) async => null);

    final cubit = WorkbenchLayoutCubit(dao);

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider.value(
          value: cubit,
          child: const AppShellView(),
        ),
      ),
    );

    await tester.pumpAndSettle();

    expect(find.byKey(const Key('workbench-left')), findsOneWidget);
    expect(find.byKey(const Key('workbench-middle')), findsOneWidget);
    expect(find.byKey(const Key('workbench-right')), findsOneWidget);
  });
}
