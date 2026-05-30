// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/manual_url_form.dart';

class _Cubit extends Cubit<EmulatorSessionState>
    with Mock
    implements EmulatorSessionCubit {
  _Cubit() : super(const EmulatorSessionState.noDevicePicked());
}

void main() {
  testWidgets('valid ws:// submission calls submitManualUrl', (tester) async {
    final cubit = _Cubit();
    when(() => cubit.submitManualUrl(any())).thenAnswer((_) async {});
    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<EmulatorSessionCubit>.value(
          value: cubit,
          child: const Scaffold(body: ManualUrlForm()),
        ),
      ),
    );
    await tester.enterText(
      find.byType(TextField),
      'ws://127.0.0.1:5000/UUID/ws',
    );
    await tester.tap(find.text('Connect'));
    await tester.pumpAndSettle();
    verify(() => cubit.submitManualUrl('ws://127.0.0.1:5000/UUID/ws'))
        .called(1);
  });

  testWidgets('invalid URL shows inline error', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<EmulatorSessionCubit>.value(
          value: _Cubit(),
          child: const Scaffold(body: ManualUrlForm()),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'http://oops');
    await tester.tap(find.text('Connect'));
    await tester.pump();
    expect(find.textContaining('must start with'), findsOneWidget);
  });
}
