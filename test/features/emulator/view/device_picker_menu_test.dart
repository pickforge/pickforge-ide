// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/device_picker_menu.dart';

class _PickerCubit extends Cubit<DevicePickerState>
    with Mock
    implements DevicePickerCubit {
  _PickerCubit(super.initialState);
  @override
  Future<void> refresh() async {}
}

class _SessionCubit extends Cubit<EmulatorSessionState>
    with Mock
    implements EmulatorSessionCubit {
  _SessionCubit() : super(const EmulatorSessionState.noDevicePicked());
}

void main() {
  setUpAll(() {
    registerFallbackValue(
      const Avd(id: 'fallback', name: 'fallback', platform: 'android'),
    );
    registerFallbackValue(
      const RunningAndroidDevice(
        serial: 'fallback',
        avdName: null,
        state: 'device',
      ),
    );
  });

  testWidgets('shows Running and Available sections', (tester) async {
    final picker = _PickerCubit(
      const DevicePickerState.loaded(
        avds: [
          Avd(id: 'X', name: 'Pixel 5', platform: 'android'),
          Avd(id: 'Y', name: 'Pixel 7', platform: 'android'),
        ],
        running: [
          RunningAndroidDevice(
            serial: 'emulator-5554',
            avdName: 'X',
            state: 'device',
          ),
        ],
      ),
    );
    final session = _SessionCubit();
    when(() => session.pickAvd(any())).thenAnswer((_) async {});
    when(() => session.pickPhysicalDevice(any())).thenAnswer((_) async {});
    when(() => session.pickIosSimulator(any())).thenAnswer((_) async {});
    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider<DevicePickerCubit>.value(value: picker),
            BlocProvider<EmulatorSessionCubit>.value(value: session),
          ],
          child: const Scaffold(body: DevicePickerMenu()),
        ),
      ),
    );
    expect(find.text('RUNNING'), findsOneWidget);
    expect(find.text('AVAILABLE'), findsOneWidget);
    expect(find.text('Pixel 5'), findsOneWidget);
    expect(find.text('Pixel 7'), findsOneWidget);
    await tester.tap(find.text('Pixel 7'));
    verify(() => session.pickAvd(any())).called(1);
  });

  testWidgets('shows connected physical devices', (tester) async {
    final picker = _PickerCubit(
      const DevicePickerState.loaded(
        avds: [],
        running: [
          RunningAndroidDevice(
            serial: 'R58M1234567',
            avdName: null,
            state: 'device',
            kind: AndroidDeviceKind.physical,
            model: 'Pixel 6',
          ),
        ],
      ),
    );
    final session = _SessionCubit();
    when(() => session.pickPhysicalDevice(any())).thenAnswer((_) async {});
    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider<DevicePickerCubit>.value(value: picker),
            BlocProvider<EmulatorSessionCubit>.value(value: session),
          ],
          child: const Scaffold(body: DevicePickerMenu()),
        ),
      ),
    );

    expect(find.text('CONNECTED'), findsOneWidget);
    expect(find.text('Pixel 6 (R58M1234567)'), findsOneWidget);
    await tester.tap(find.text('Pixel 6 (R58M1234567)'));
    verify(() => session.pickPhysicalDevice(any())).called(1);
  });

  testWidgets('shows connected iOS simulators', (tester) async {
    final picker = _PickerCubit(
      const DevicePickerState.loaded(
        avds: [],
        running: [
          RunningAndroidDevice(
            serial: 'A1B2C3D4-0000-1111-2222-333344445555',
            avdName: 'iPhone 16',
            state: 'device',
            kind: AndroidDeviceKind.iosSimulator,
            model: 'iPhone 16',
          ),
        ],
      ),
    );
    final session = _SessionCubit();
    when(() => session.pickIosSimulator(any())).thenAnswer((_) async {});
    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider<DevicePickerCubit>.value(value: picker),
            BlocProvider<EmulatorSessionCubit>.value(value: session),
          ],
          child: const Scaffold(body: DevicePickerMenu()),
        ),
      ),
    );

    expect(find.text('CONNECTED'), findsOneWidget);
    expect(
      find.text('iPhone 16 (A1B2C3D4-0000-1111-2222-333344445555)'),
      findsOneWidget,
    );
    await tester.tap(
      find.text('iPhone 16 (A1B2C3D4-0000-1111-2222-333344445555)'),
    );
    verify(() => session.pickIosSimulator(any())).called(1);
  });

  testWidgets('shows connected web targets', (tester) async {
    final picker = _PickerCubit(
      const DevicePickerState.loaded(
        avds: [],
        running: [
          RunningAndroidDevice(
            serial: flutterWebChromeId,
            avdName: 'Chrome',
            state: 'device',
            kind: AndroidDeviceKind.web,
            model: 'web-javascript',
          ),
        ],
      ),
    );
    final session = _SessionCubit();
    when(() => session.pickWebTarget(any())).thenAnswer((_) async {});
    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider<DevicePickerCubit>.value(value: picker),
            BlocProvider<EmulatorSessionCubit>.value(value: session),
          ],
          child: const Scaffold(body: DevicePickerMenu()),
        ),
      ),
    );

    expect(find.text('CONNECTED'), findsOneWidget);
    expect(find.text('Chrome (chrome)'), findsOneWidget);
    await tester.tap(find.text('Chrome (chrome)'));
    verify(() => session.pickWebTarget(any())).called(1);
  });

  testWidgets('empty state explains no Flutter devices were detected',
      (tester) async {
    final picker =
        _PickerCubit(const DevicePickerState.loaded(avds: [], running: []));
    await tester.pumpWidget(
      MaterialApp(
        home: MultiBlocProvider(
          providers: [
            BlocProvider<DevicePickerCubit>.value(value: picker),
            BlocProvider<EmulatorSessionCubit>.value(value: _SessionCubit()),
          ],
          child: const Scaffold(body: DevicePickerMenu()),
        ),
      ),
    );
    expect(
      find.textContaining('No Flutter devices detected'),
      findsOneWidget,
    );
  });
}
