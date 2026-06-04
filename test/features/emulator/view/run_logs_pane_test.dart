import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/emulator/view/run_logs_pane.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

void main() {
  testWidgets('renders entries', (tester) async {
    final cubit = RunLogsCubit()
      ..append(const RunSessionEvent.log(line: 'hello', level: LogLevel.info))
      ..append(const RunSessionEvent.log(line: 'oops', level: LogLevel.error));
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<RunLogsCubit>.value(
          value: cubit,
          child: const Scaffold(body: RunLogsPane()),
        ),
      ),
    );
    expect(find.text('hello'), findsOneWidget);
    expect(find.text('oops'), findsOneWidget);
  });

  testWidgets('Errors filter shows only error level', (tester) async {
    final cubit = RunLogsCubit()
      ..append(const RunSessionEvent.log(line: 'hello', level: LogLevel.info))
      ..append(const RunSessionEvent.log(line: 'oops', level: LogLevel.error));
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<RunLogsCubit>.value(
          value: cubit,
          child: const Scaffold(body: RunLogsPane()),
        ),
      ),
    );
    await tester.tap(find.text('Errors'));
    await tester.pumpAndSettle();
    expect(find.text('hello'), findsNothing);
    expect(find.text('oops'), findsOneWidget);
  });
}
