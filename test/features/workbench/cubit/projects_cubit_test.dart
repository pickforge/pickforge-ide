import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

class _MockRepo extends Mock implements ProjectsRepository {}

class _MockPtyPool extends Mock implements PtySessionPool {}

ProjectRow _row(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  late _MockRepo repo;
  late _MockPtyPool ptyPool;
  setUp(() {
    repo = _MockRepo();
    ptyPool = _MockPtyPool();
    when(ptyPool.parkAll).thenAnswer((_) async {});
  });

  blocTest<ProjectsCubit, ProjectsState>(
    'load emits Loading then Ready with first project active',
    setUp: () {
      when(() => repo.list()).thenAnswer((_) async => [_row('/p')]);
    },
    build: () => ProjectsCubit(repo, ptyPool),
    act: (c) => c.load(),
    expect: () => [
      isA<ProjectsLoading>(),
      isA<ProjectsReady>()
          .having((s) => s.projects.length, 'count', 1)
          .having((s) => s.activeProjectRoot, 'active', '/p'),
    ],
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'add invokes repo, reloads and selects the added project',
    setUp: () {
      when(() => repo.add('/x')).thenAnswer((_) async => _row('/x'));
      when(() => repo.list()).thenAnswer((_) async => [_row('/x')]);
    },
    build: () => ProjectsCubit(repo, ptyPool),
    act: (c) => c.add('/x'),
    expect: () => [
      isA<ProjectsLoading>(),
      isA<ProjectsReady>()
          .having((s) => s.projects.length, 'count', 1)
          .having((s) => s.activeProjectRoot, 'active', '/x'),
    ],
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'selectProject touches and updates active',
    setUp: () {
      when(() => repo.list()).thenAnswer((_) async => [_row('/a'), _row('/b')]);
      when(() => repo.touch('/b')).thenAnswer((_) async {});
    },
    build: () => ProjectsCubit(repo, ptyPool),
    act: (c) async {
      await c.load();
      await c.selectProject('/b');
    },
    skip: 2,
    expect: () => [
      isA<ProjectsReady>().having((s) => s.activeProjectRoot, 'active', '/b'),
    ],
    verify: (_) {
      verify(() => repo.touch('/b')).called(1);
      verify(ptyPool.parkAll).called(1);
    },
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'selectProject does not park PTYs when selecting active project again',
    setUp: () {
      when(() => repo.list()).thenAnswer((_) async => [_row('/a')]);
      when(() => repo.touch('/a')).thenAnswer((_) async {});
    },
    build: () => ProjectsCubit(repo, ptyPool),
    act: (c) async {
      await c.load();
      await c.selectProject('/a');
    },
    verify: (_) {
      verifyNever(ptyPool.parkAll);
    },
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'add error surfaces ProjectsError',
    setUp: () {
      when(() => repo.add('/bad'))
          .thenThrow(ProjectAddError('no pubspec.yaml'));
    },
    build: () => ProjectsCubit(repo, ptyPool),
    act: (c) => c.add('/bad'),
    expect: () => [
      isA<ProjectsLoading>(),
      isA<ProjectsError>().having(
        (e) => e.message,
        'message',
        contains('no pubspec.yaml'),
      ),
    ],
  );
}
