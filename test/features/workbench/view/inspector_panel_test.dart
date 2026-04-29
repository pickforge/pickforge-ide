import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';

class _MockCubit extends Mock implements WidgetPickerCubit {}

void main() {
  testWidgets('renders disconnected pill and placeholder when no selection',
      (tester) async {
    final cubit = _MockCubit();
    final state = WidgetPickerState.initial();
    when(() => cubit.state).thenReturn(state);
    when(() => cubit.stream).thenAnswer((_) => Stream.fromIterable([state]));

    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: InspectorPanel(cubit: cubit))),
    );

    expect(find.text('Pick device'), findsOneWidget);
    expect(find.text('No widget selected'), findsOneWidget);
  });
}
