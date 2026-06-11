import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

class _MockRepo extends Mock implements ProjectsRepository {}

ProjectRow _row(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  late _MockRepo repo;
  setUp(() {
    repo = _MockRepo();
    when(() => repo.archivedProjects()).thenAnswer((_) async => []);
  });

  blocTest<ProjectsCubit, ProjectsState>(
    'load emits Loading then Ready with first project active',
    setUp: () {
      when(() => repo.list()).thenAnswer((_) async => [_row('/p')]);
    },
    build: () => ProjectsCubit(repo),
    act: (c) => c.load(),
    expect: () => [
      isA<ProjectsLoading>(),
      isA<ProjectsReady>()
          .having((s) => s.projects.length, 'count', 1)
          .having((s) => s.activeProjectRoot, 'active', '/p'),
    ],
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'add invokes repo and selects the added project',
    setUp: () {
      when(() => repo.add('/x')).thenAnswer((_) async => _row('/x'));
      when(() => repo.list()).thenAnswer((_) async => [_row('/x')]);
    },
    build: () => ProjectsCubit(repo),
    act: (c) => c.add('/x'),
    expect: () => [
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
    build: () => ProjectsCubit(repo),
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
    },
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'add error returns the message and recovers to a usable Ready state',
    setUp: () {
      when(() => repo.add('/bad'))
          .thenThrow(ProjectAddError('Folder does not exist: /bad'));
      when(() => repo.list()).thenAnswer((_) async => [_row('/p')]);
    },
    build: () => ProjectsCubit(repo),
    act: (c) async {
      final error = await c.add('/bad');
      expect(error, contains('Folder does not exist'));
    },
    expect: () => [
      isA<ProjectsLoading>(),
      isA<ProjectsReady>()
          .having((s) => s.projects.length, 'count', 1)
          .having((s) => s.activeProjectRoot, 'active', '/p'),
    ],
  );

  blocTest<ProjectsCubit, ProjectsState>(
    'archive hides the project and switches the active selection',
    setUp: () {
      var archived = false;
      when(() => repo.list()).thenAnswer(
        (_) async => archived ? [_row('/b')] : [_row('/a'), _row('/b')],
      );
      when(() => repo.archive('/a')).thenAnswer((_) async => archived = true);
      when(() => repo.archivedProjects()).thenAnswer(
        (_) async => archived ? [_row('/a')] : [],
      );
    },
    build: () => ProjectsCubit(repo),
    act: (c) async {
      await c.load();
      await c.archive('/a');
    },
    skip: 2,
    expect: () => [
      isA<ProjectsReady>()
          .having((s) => s.projects.length, 'count', 1)
          .having((s) => s.activeProjectRoot, 'active', '/b')
          .having((s) => s.archivedProjects.length, 'archived', 1),
    ],
  );
}
