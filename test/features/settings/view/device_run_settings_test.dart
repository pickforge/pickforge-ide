// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_state.dart';
import 'package:pickforge/features/settings/view/device_run_settings.dart';

class _Cubit extends Cubit<DeviceRunSettingsState>
    with Mock
    implements DeviceRunSettingsCubit {
  _Cubit(super.initialState);
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
    registerFallbackValue(const RunArgs());
    registerFallbackValue(const EmulatorLaunchOptions());
    registerFallbackValue(const EmulatorIdleShutdownSettings());
  });

  testWidgets('renders AVD list and picking calls cubit', (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        avds: [Avd(id: 'p5', name: 'Pixel 5', platform: 'android')],
      ),
    );
    when(() => cubit.setAvd(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    expect(find.text('Device & Run'), findsOneWidget);
    await tester.tap(find.byKey(const Key('device-dropdown')));
    await tester.pumpAndSettle();
    expect(find.text('Pixel 5'), findsOneWidget);
    await tester.tap(find.text('Pixel 5'));
    await tester.pumpAndSettle();
    verify(() => cubit.setAvd('/p', any())).called(1);
  });

  testWidgets('renders physical device list and picking calls cubit',
      (tester) async {
    const device = RunningAndroidDevice(
      serial: 'R58M1234567',
      avdName: null,
      state: 'device',
      kind: AndroidDeviceKind.physical,
      model: 'Pixel 6',
    );
    final cubit = _Cubit(
      const DeviceRunSettingsState(runningDevices: [device]),
    );
    when(() => cubit.setPhysicalDevice(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('device-dropdown')));
    await tester.pumpAndSettle();
    expect(find.text('Pixel 6 (R58M1234567)'), findsOneWidget);
    await tester.tap(find.text('Pixel 6 (R58M1234567)').last);
    await tester.pumpAndSettle();

    verify(() => cubit.setPhysicalDevice('/p', device)).called(1);
  });

  testWidgets('renders iOS simulator list and picking calls cubit',
      (tester) async {
    const device = RunningAndroidDevice(
      serial: 'A1B2C3D4-0000-1111-2222-333344445555',
      avdName: 'iPhone 16',
      state: 'device',
      kind: AndroidDeviceKind.iosSimulator,
      model: 'iPhone 16',
    );
    final cubit = _Cubit(
      const DeviceRunSettingsState(runningDevices: [device]),
    );
    when(() => cubit.setIosSimulator(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('device-dropdown')));
    await tester.pumpAndSettle();
    expect(
      find.text('iPhone 16 (A1B2C3D4-0000-1111-2222-333344445555)'),
      findsOneWidget,
    );
    await tester.tap(
      find.text('iPhone 16 (A1B2C3D4-0000-1111-2222-333344445555)').last,
    );
    await tester.pumpAndSettle();

    verify(() => cubit.setIosSimulator('/p', device)).called(1);
  });

  testWidgets('manual mode reveals URL field', (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        binding: EmulatorBinding.manual(vmServiceUrl: 'ws://127.0.0.1:5000/ws'),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    expect(find.text('Manual VM Service URL'), findsOneWidget);
    expect(find.text('ws://127.0.0.1:5000/ws'), findsOneWidget);
  });

  testWidgets('target dropdown persists selected target', (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        targetFiles: ['lib/main.dart', 'lib/main_dev.dart'],
      ),
    );
    when(() => cubit.setRunArgs(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('run-target-dropdown')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('lib/main_dev.dart').last);
    await tester.pumpAndSettle();

    verify(
      () => cubit.setRunArgs(
        '/p',
        const RunArgs(targetFile: 'lib/main_dev.dart'),
      ),
    ).called(1);
  });

  testWidgets('build mode preserves flavor and manual args', (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        runArgs: RunArgs(
          extraArgs: ['--flavor', 'dev', '--dart-define=FOO=bar'],
        ),
      ),
    );
    when(() => cubit.setRunArgs(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    await tester.tap(find.text('Release'));
    await tester.pumpAndSettle();

    verify(
      () => cubit.setRunArgs(
        '/p',
        const RunArgs(
          extraArgs: ['--release', '--flavor', 'dev', '--dart-define=FOO=bar'],
        ),
      ),
    ).called(1);
  });

  testWidgets('flavor field persists structured flavor', (tester) async {
    final cubit =
        _Cubit(const DeviceRunSettingsState(flavors: ['dev', 'prod']));
    when(() => cubit.setRunArgs(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    await tester.enterText(find.byKey(const ValueKey('run-flavor-')), 'prod');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    verify(
      () => cubit.setRunArgs(
        '/p',
        const RunArgs(extraArgs: ['--flavor', 'prod']),
      ),
    ).called(1);
  });

  testWidgets('extra args field preserves manual args', (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        runArgs: RunArgs(extraArgs: ['--release', '--flavor', 'prod']),
      ),
    );
    when(() => cubit.setRunArgs(any(), any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(body: DeviceRunSettings(projectRoot: '/p')),
        ),
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('run-extra-')),
      '--dart-define=NAME="Pick Forge"',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();

    verify(
      () => cubit.setRunArgs(
        '/p',
        const RunArgs(
          extraArgs: [
            '--release',
            '--flavor',
            'prod',
            '--dart-define=NAME=Pick Forge',
          ],
        ),
      ),
    ).called(1);
  });

  testWidgets('emulator launch controls persist option changes',
      (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        binding: EmulatorBinding.avd(avdId: 'p5', avdName: 'Pixel 5'),
        emulatorLaunchOptions: EmulatorLaunchOptions(port: 5556),
      ),
    );
    when(() => cubit.setEmulatorLaunchOptions(any(), any()))
        .thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(
            body: SingleChildScrollView(
              child: DeviceRunSettings(projectRoot: '/p'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('emulator-no-audio')));
    await tester.pump();
    verify(
      () => cubit.setEmulatorLaunchOptions(
        '/p',
        const EmulatorLaunchOptions(noAudio: true, port: 5556),
      ),
    ).called(1);

    await tester.tap(find.byKey(const Key('emulator-gpu-mode')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Host').last);
    await tester.pumpAndSettle();
    verify(
      () => cubit.setEmulatorLaunchOptions(
        '/p',
        const EmulatorLaunchOptions(gpuMode: EmulatorGpuMode.host, port: 5556),
      ),
    ).called(1);

    await tester.enterText(
      find.byKey(const ValueKey('emulator-port-5556')),
      '5558',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    verify(
      () => cubit.setEmulatorLaunchOptions(
        '/p',
        const EmulatorLaunchOptions(port: 5558),
      ),
    ).called(1);
  });

  testWidgets('idle shutdown controls persist prompt and automatic modes',
      (tester) async {
    final cubit = _Cubit(
      const DeviceRunSettingsState(
        binding: EmulatorBinding.avd(avdId: 'p5', avdName: 'Pixel 5'),
      ),
    );
    when(() => cubit.setIdleShutdownSettings(any(), any()))
        .thenAnswer((_) async {});

    await tester.pumpWidget(
      MaterialApp(
        home: BlocProvider<DeviceRunSettingsCubit>.value(
          value: cubit,
          child: const Scaffold(
            body: SingleChildScrollView(
              child: DeviceRunSettings(projectRoot: '/p'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('emulator-idle-shutdown-enabled')));
    await tester.pump();

    verify(
      () => cubit.setIdleShutdownSettings(
        '/p',
        const EmulatorIdleShutdownSettings(enabled: true),
      ),
    ).called(1);

    cubit.emit(
      const DeviceRunSettingsState(
        binding: EmulatorBinding.avd(avdId: 'p5', avdName: 'Pixel 5'),
        idleShutdownSettings: EmulatorIdleShutdownSettings(enabled: true),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('emulator-idle-shutdown-confirm')));
    await tester.pump();

    verify(
      () => cubit.setIdleShutdownSettings(
        '/p',
        const EmulatorIdleShutdownSettings(
          enabled: true,
          requireConfirmation: false,
        ),
      ),
    ).called(1);
  });
}
