// mocktail wrapping closures.
// ignore_for_file: unnecessary_lambdas

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/view/onboarding_view.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockRepo extends Mock implements ProjectsRepository {}

ProjectRow _row(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  testWidgets('Pick folder button visible and triggers cubit add',
      (tester) async {
    final repo = _MockRepo();
    when(() => repo.add('/picked')).thenAnswer((_) async => _row('/picked'));
    when(() => repo.list()).thenAnswer((_) async => [_row('/picked')]);

    final cubit = ProjectsCubit(repo, PtySessionPool());

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider.value(
          value: cubit,
          child: OnboardingView(pickFolder: () async => '/picked'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Pick folder'), findsOneWidget);
    expect(find.text('First-run checklist'), findsOneWidget);
    expect(find.text('Explore demo mode'), findsOneWidget);
    expect(find.text('Open sample Flutter app'), findsOneWidget);
    expect(find.text('Dismiss for now'), findsOneWidget);

    await tester.tap(find.text('Pick folder'));
    await tester.pumpAndSettle();

    verify(() => repo.add('/picked')).called(1);
  });

  testWidgets('demo mode can be previewed without adding a project',
      (tester) async {
    final repo = _MockRepo();
    final cubit = ProjectsCubit(repo, PtySessionPool());

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider.value(
          value: cubit,
          child: OnboardingView(pickFolder: () async => null),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Explore demo mode'));
    await tester.pumpAndSettle();

    expect(find.text('Demo workspace'), findsOneWidget);
    expect(find.text('CounterPage'), findsOneWidget);
  });

  testWidgets('sample app button adds fixture project', (tester) async {
    final repo = _MockRepo();
    when(() => repo.add('/sample')).thenAnswer((_) async => _row('/sample'));
    when(() => repo.list()).thenAnswer((_) async => [_row('/sample')]);
    final cubit = ProjectsCubit(repo, PtySessionPool());

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider.value(
          value: cubit,
          child: OnboardingView(
            pickFolder: () async => null,
            sampleProjectRoot: '/sample',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Open sample Flutter app'));
    await tester.pumpAndSettle();

    verify(() => repo.add('/sample')).called(1);
  });

  testWidgets('dismiss button calls dismiss callback', (tester) async {
    final repo = _MockRepo();
    final cubit = ProjectsCubit(repo, PtySessionPool());
    var dismissed = false;

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider.value(
          value: cubit,
          child: OnboardingView(
            pickFolder: () async => null,
            dismissOnboarding: () async => dismissed = true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Dismiss for now'));
    await tester.pumpAndSettle();

    expect(dismissed, isTrue);
  });

  testWidgets('setup checks show available and missing tools', (tester) async {
    final repo = _MockRepo();
    final cubit = ProjectsCubit(repo, PtySessionPool());
    var openedSettings = false;

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider.value(
          value: cubit,
          child: OnboardingView(
            pickFolder: () async => null,
            diagnosticsService: DiagnosticsService(
              _FakeRunner({
                'fvm': 0,
                'adb': 1,
                'emulator': 1,
                'claude': 1,
                'codex': 0,
                'opencode': 1,
              }),
            ),
            openSettings: () => openedSettings = true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Setup checks'), findsOneWidget);
    expect(find.text('Flutter/FVM'), findsOneWidget);
    expect(find.text('adb'), findsOneWidget);
    expect(find.text('Available'), findsNWidgets(2));
    expect(find.text('Missing'), findsNWidgets(4));
    expect(find.text('Open settings'), findsOneWidget);

    await tester.ensureVisible(find.text('Open settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open settings'));
    await tester.pump();

    expect(openedSettings, isTrue);
  });
}

class _FakeRunner implements ProcessRunner {
  _FakeRunner(this.exitCodes);

  final Map<String, int> exitCodes;

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    return ProcessResult(1, exitCodes[executable] ?? 1, '', '');
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}
