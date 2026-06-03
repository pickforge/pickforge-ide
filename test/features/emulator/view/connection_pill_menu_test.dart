// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

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
    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<EmulatorSessionCubit>.value(
          value: _FakeCubit(state),
          child: const Scaffold(body: ConnectionPill()),
        ),
      ),
    );
  }

  testWidgets('dropdown surfaces Pick different when state is Cold',
      (tester) async {
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

  testWidgets('Running state surfaces Hot restart, Stop, View logs',
      (tester) async {
    await pump(
      tester,
      EmulatorSessionState.running(vmServiceUri: 'ws://x', stats: RunStats()),
    );
    await tester.tap(find.byKey(const Key('pill-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Hot restart'), findsOneWidget);
    expect(find.text('Stop'), findsOneWidget);
    expect(find.text('View logs'), findsOneWidget);
    expect(find.text('View run history'), findsOneWidget);
  });

  testWidgets('Idle shutdown prompt surfaces keep and shutdown menu actions',
      (tester) async {
    await pump(
      tester,
      EmulatorSessionState.idle(
        avd: const Avd(id: 'A', name: 'Pixel 5', platform: 'android'),
        serial: 'emulator-5554',
        idleSince: DateTime.utc(2026, 6, 3),
        shutdownPrompt: true,
      ),
    );
    await tester.tap(find.byKey(const Key('pill-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Keep running'), findsOneWidget);
    expect(find.text('Shutdown emulator'), findsOneWidget);
    expect(find.text('Pick different...'), findsOneWidget);
  });

  testWidgets('RecoveryPending surfaces adopt and cleanup', (tester) async {
    await pump(
      tester,
      EmulatorSessionState.recoveryPending(
        sessionId: 's',
        pid: 4242,
        serial: 'emulator-5554',
        startedAt: DateTime.utc(2026, 6, 3),
        avd: const Avd(id: 'A', name: 'Pixel 5', platform: 'android'),
        vmServiceUri: 'ws://x/ws',
        canAdopt: true,
      ),
    );
    await tester.tap(find.byKey(const Key('pill-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Adopt recovered run'), findsOneWidget);
    expect(find.text('Clean up orphaned run'), findsOneWidget);
    expect(find.text('View run history'), findsOneWidget);
  });

  testWidgets('Recovered running state surfaces cleanup instead of restart',
      (tester) async {
    await pump(
      tester,
      EmulatorSessionState.running(
        vmServiceUri: 'ws://x',
        stats: RunStats(),
        recovered: true,
      ),
    );
    await tester.tap(find.byKey(const Key('pill-menu')));
    await tester.pumpAndSettle();
    expect(find.text('Hot restart'), findsNothing);
    expect(find.text('Clean up orphaned run'), findsOneWidget);
  });
}
