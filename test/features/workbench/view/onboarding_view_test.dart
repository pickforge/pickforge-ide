// mocktail wrapping closures.
// ignore_for_file: unnecessary_lambdas

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
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

    final cubit = ProjectsCubit(repo);

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

    await tester.tap(find.text('Pick folder'));
    await tester.pumpAndSettle();

    verify(() => repo.add('/picked')).called(1);
  });
}
