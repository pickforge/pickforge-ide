import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/connection_pill.dart';

class _FakeCubit extends Cubit<EmulatorSessionState>
    implements EmulatorSessionCubit {
  _FakeCubit(super.initialState);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
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

  testWidgets('NoDevicePicked shows Pick device', (tester) async {
    await pump(tester, const EmulatorSessionState.noDevicePicked());
    expect(find.text('Pick device'), findsOneWidget);
  });

  testWidgets('Cold shows AVD name and Boot button', (tester) async {
    await pump(
      tester,
      const EmulatorSessionState.cold(
        avd: Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android'),
      ),
    );
    expect(find.text('Pixel 5 API 34'), findsOneWidget);
    expect(find.text('Boot'), findsOneWidget);
  });

  testWidgets('Idle shows Run app button', (tester) async {
    await pump(
      tester,
      const EmulatorSessionState.idle(
        avd: Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android'),
        serial: 'emulator-5554',
      ),
    );
    expect(find.text('Run app'), findsOneWidget);
  });

  testWidgets('Running shows Reload button + AVD name', (tester) async {
    await pump(
      tester,
      EmulatorSessionState.running(
        avd: const Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android'),
        serial: 'emulator-5554',
        vmServiceUri: 'ws://x',
        stats: RunStats(),
      ),
    );
    expect(find.text('Pixel 5 API 34'), findsOneWidget);
    expect(find.text('Reload'), findsOneWidget);
  });

  testWidgets('Manual mode shows Manual label', (tester) async {
    await pump(
      tester,
      EmulatorSessionState.running(
        vmServiceUri: 'ws://127.0.0.1:51234',
        stats: RunStats(),
        manual: true,
      ),
    );
    expect(find.text('Manual'), findsOneWidget);
  });

  testWidgets('wraps state content in AnimatedSwitcher', (tester) async {
    await pump(tester, const EmulatorSessionState.noDevicePicked());
    final switcher =
        tester.widget<AnimatedSwitcher>(find.byType(AnimatedSwitcher));
    expect(switcher.duration, const Duration(milliseconds: 180));
  });

  testWidgets('Booting animates status dot', (tester) async {
    await pump(
      tester,
      const EmulatorSessionState.booting(
        avd: Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android'),
      ),
    );
    await tester.pump();
    expect(find.byType(ScaleTransition), findsWidgets);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('Running with lastReloadAt pulses status dot', (tester) async {
    await pump(
      tester,
      EmulatorSessionState.running(
        vmServiceUri: 'ws://x',
        stats: RunStats(),
        lastReloadAt: DateTime(2026),
      ),
    );
    expect(find.byKey(const Key('reload-pulse-dot')), findsOneWidget);
  });
}
