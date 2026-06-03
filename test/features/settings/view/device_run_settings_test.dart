// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_models.dart';
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
    registerFallbackValue(const RunArgs());
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
    await tester.tap(find.byType(DropdownButton<Avd>));
    await tester.pumpAndSettle();
    expect(find.text('Pixel 5'), findsOneWidget);
    await tester.tap(find.text('Pixel 5'));
    await tester.pumpAndSettle();
    verify(() => cubit.setAvd('/p', any())).called(1);
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
}
