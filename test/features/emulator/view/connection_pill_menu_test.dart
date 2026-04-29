import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/connection_pill.dart';

class _FakeCubit extends Cubit<EmulatorSessionState>
    with Mock
    implements EmulatorSessionCubit {
  _FakeCubit(super.initialState);
}

void main() {
  Future<void> pump(WidgetTester tester, EmulatorSessionState state) async {
    await tester.pumpWidget(MaterialApp(
      home: BlocProvider<EmulatorSessionCubit>.value(
        value: _FakeCubit(state),
        child: const Scaffold(body: ConnectionPill()),
      ),
    ));
  }

  testWidgets('dropdown surfaces Pick different when state is Cold', (tester) async {
    await pump(
      tester,
      const EmulatorSessionState.cold(
        avd: Avd(id: 'A', name: 'Pixel 5', platform: 'android'),
      ),
    );
    await tester.tap(find.byKey(const Key('pill-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Pick different...'), findsOneWidget);
    expect(find.text('Manual VM Service URL...'), findsOneWidget);
    expect(find.text('Forget device'), findsOneWidget);
  });

  testWidgets('Running state surfaces Hot restart, Stop, View logs', (tester) async {
    await pump(
      tester,
      EmulatorSessionState.running(vmServiceUri: 'ws://x', stats: RunStats()),
    );
    await tester.tap(find.byKey(const Key('pill-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Hot restart'), findsOneWidget);
    expect(find.text('Stop'), findsOneWidget);
    expect(find.text('View logs'), findsOneWidget);
  });
}
