import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';

class _MockDao extends Mock implements ProjectSettingsDao {}

void main() {
  late _MockDao dao;
  setUp(() => dao = _MockDao());

  blocTest<WorkbenchLayoutCubit, WorkbenchLayoutState>(
    'load reads JSON pane sizes',
    setUp: () {
      when(() => dao.paneSizes('/p')).thenAnswer((_) async => '[200,310]');
    },
    build: () => WorkbenchLayoutCubit(dao),
    act: (c) => c.load('/p'),
    expect: () => [
      isA<WorkbenchLayoutState>()
          .having((s) => s.leftWidth, 'left', 200)
          .having((s) => s.rightWidth, 'right', 310),
    ],
  );

  blocTest<WorkbenchLayoutCubit, WorkbenchLayoutState>(
    'load with no stored value emits projectRoot only (defaults preserved)',
    setUp: () {
      when(() => dao.paneSizes('/p')).thenAnswer((_) async => null);
    },
    build: () => WorkbenchLayoutCubit(dao),
    act: (c) => c.load('/p'),
    expect: () => [
      isA<WorkbenchLayoutState>()
          .having((s) => s.projectRoot, 'projectRoot', '/p')
          .having((s) => s.leftWidth, 'left', 220)
          .having((s) => s.rightWidth, 'right', 320),
    ],
  );

  blocTest<WorkbenchLayoutCubit, WorkbenchLayoutState>(
    'updateSizes persists JSON',
    setUp: () {
      when(() => dao.paneSizes('/p')).thenAnswer((_) async => null);
      when(() => dao.setPaneSizes('/p', any())).thenAnswer((_) async {});
    },
    build: () => WorkbenchLayoutCubit(dao),
    act: (c) async {
      await c.load('/p');
      c.updateSizes(left: 240, right: 320);
    },
    verify: (_) {
      verify(() => dao.setPaneSizes('/p', '[240.0,320.0]')).called(1);
    },
  );

  blocTest<WorkbenchLayoutCubit, WorkbenchLayoutState>(
    'toggleRightCollapsed flips the flag',
    build: () => WorkbenchLayoutCubit(dao),
    act: (c) => c.toggleRightCollapsed(),
    expect: () => [
      isA<WorkbenchLayoutState>().having(
        (s) => s.rightCollapsed,
        'rightCollapsed',
        true,
      ),
    ],
  );
}
