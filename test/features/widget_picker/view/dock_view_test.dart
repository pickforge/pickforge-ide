import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockCubit extends Mock implements WidgetPickerCubit {}

void main() {
  setUp(() async {
    await configureDependencies();
  });

  tearDown(getIt.reset);

  testWidgets('shows placeholder when selection is null', (tester) async {
    tester.view.physicalSize = const Size(1400, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final cubit = _MockCubit();
    final initialState = WidgetPickerState.initial();
    when(() => cubit.state).thenReturn(initialState);
    when(() => cubit.stream).thenAnswer(
      (_) => Stream.fromIterable([initialState]),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: DockView(cubit: cubit)),
      ),
    );
    // Animation repeats forever; advance past one cycle then cancel timers.
    await tester.pump(const Duration(seconds: 3));

    expect(
      find.text('Tap a widget in the emulator to pick it'),
      findsOneWidget,
    );
  });
}
