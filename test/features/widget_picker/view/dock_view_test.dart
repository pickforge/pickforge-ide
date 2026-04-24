import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';

class _MockCubit extends Mock implements WidgetPickerCubit {}

void main() {
  testWidgets('shows placeholder when selection is null', (tester) async {
    final cubit = _MockCubit();
    final initialState = WidgetPickerState.initial();
    when(() => cubit.state).thenReturn(initialState);
    when(() => cubit.stream).thenAnswer(
      (_) => Stream.fromIterable([initialState]),
    );

    await tester.pumpWidget(
      MaterialApp(home: DockView(cubit: cubit)),
    );

    expect(
      find.text('Tap a widget in the emulator to pick it'),
      findsOneWidget,
    );
  });
}
