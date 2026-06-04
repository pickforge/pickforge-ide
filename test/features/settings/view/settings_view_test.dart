// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _ProjectsCubit extends Cubit<ProjectsState>
    with Mock
    implements ProjectsCubit {
  _ProjectsCubit(super.initialState);
}

class _ProjectSettingsRepo extends Mock implements ProjectSettingsRepository {}

class _TerminalSettingsRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

class _DeviceDiscovery extends Mock implements DeviceDiscoveryService {}

class _DiagnosticsRunner extends Mock implements ProcessRunner {}

ProjectRow _project(String root) => ProjectRow(
      projectRoot: root,
      displayName: 'Project',
      createdAt: DateTime(2026, 6, 2),
      lastOpenedAt: DateTime(2026, 6, 2),
      sortOrder: 0,
    );

void main() {
  late _ProjectSettingsRepo settings;
  late _TerminalSettingsRepo terminal;
  late _DeviceDiscovery discovery;
  late _DiagnosticsRunner diagnosticsRunner;
  String? clipboardText;

  setUp(() {
    settings = _ProjectSettingsRepo();
    terminal = _TerminalSettingsRepo();
    discovery = _DeviceDiscovery();
    diagnosticsRunner = _DiagnosticsRunner();
    clipboardText = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      switch (call.method) {
        case 'Clipboard.setData':
          final args = call.arguments as Map<Object?, Object?>;
          clipboardText = args['text'] as String?;
          return null;
        case 'Clipboard.getData':
          return <String, dynamic>{'text': clipboardText};
      }
      return null;
    });
    when(() => terminal.load()).thenAnswer(
      (_) async => EmbeddedTerminalSettings.defaults,
    );
    when(() => settings.getDefaultAgentId(any())).thenAnswer((_) async => null);
    when(() => settings.getEmulatorBinding(any()))
        .thenAnswer((_) async => null);
    when(() => settings.getRunArgs(any()))
        .thenAnswer((_) async => const RunArgs());
    when(() => settings.getEmulatorLaunchOptions(any()))
        .thenAnswer((_) async => const EmulatorLaunchOptions());
    when(() => settings.getEmulatorIdleShutdownSettings(any()))
        .thenAnswer((_) async => const EmulatorIdleShutdownSettings());
    when(discovery.snapshot).thenAnswer(
      (_) async => const DeviceListSnapshot(avds: [], running: []),
    );
    when(
      () => diagnosticsRunner.run(
        any(),
        any(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer(
      (invocation) async {
        final executable = invocation.positionalArguments.first as String;
        return ProcessResult(
          1,
          0,
          executable == 'fvm' ? 'Flutter 3.41.7 • channel stable\nTools' : '',
          '',
        );
      },
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  testWidgets('loads settings for the active project', (tester) async {
    final projectsCubit = _ProjectsCubit(
      ProjectsReady(
        projects: [_project('/workspace/app')],
        activeProjectRoot: '/workspace/app',
      ),
    );
    final settingsCubit = SettingsCubit(settings, terminal);
    final deviceRunCubit = DeviceRunSettingsCubit(
      settings: settings,
      discovery: discovery,
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<ProjectsCubit>.value(
          value: projectsCubit,
          child: Scaffold(
            body: SettingsView(
              settingsCubit: settingsCubit,
              deviceRunSettingsCubit: deviceRunCubit,
              diagnosticsService: DiagnosticsService(
                diagnosticsRunner,
                appVersion: '9.8.7+6',
              )
                ..recordVmError('SocketException: apiKey=secret')
                ..recordRunError('Run failed: token=secret')
                ..recordAgentError('Agent failed: password=secret'),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    verify(() => settings.getDefaultAgentId('/workspace/app')).called(1);
    verify(() => settings.getRunArgs('/workspace/app')).called(1);
    expect(find.text('Diagnostics'), findsOneWidget);
    expect(find.text('App version'), findsOneWidget);
    expect(find.text('9.8.7+6'), findsOneWidget);
    expect(find.text('Flutter 3.41.7 • channel stable'), findsOneWidget);
    expect(find.text('Last VM error'), findsOneWidget);
    expect(find.text('SocketException: apiKey=[REDACTED]'), findsNWidgets(2));
    expect(find.text('Recent failures'), findsOneWidget);
    expect(find.text('Connection'), findsOneWidget);
    expect(find.text('Run'), findsOneWidget);
    expect(find.text('Agent'), findsOneWidget);
    expect(find.text('Run failed: token=[REDACTED]'), findsOneWidget);
    expect(find.text('Agent failed: password=[REDACTED]'), findsOneWidget);

    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -1000),
    );
    await tester.pump();

    final copyButton = find.byTooltip('Copy error details').first;
    await tester.tap(copyButton);
    await tester.pump();

    expect(clipboardText, contains('Kind: connection'));
    expect(
      clipboardText,
      contains('SocketException: apiKey=[REDACTED]'),
    );
    expect(find.text('Error details copied'), findsOneWidget);
  });

  testWidgets('shows empty state when no project is selected', (tester) async {
    final projectsCubit = _ProjectsCubit(const ProjectsReady(projects: []));

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<ProjectsCubit>.value(
          value: projectsCubit,
          child: Scaffold(
            body: SettingsView(
              settingsCubit: SettingsCubit(settings, terminal),
              deviceRunSettingsCubit: DeviceRunSettingsCubit(
                settings: settings,
                discovery: discovery,
              ),
            ),
          ),
        ),
      ),
    );

    expect(
      find.text('Select a project to configure project settings.'),
      findsOneWidget,
    );
    verifyNever(() => settings.getDefaultAgentId(any()));
  });
}
