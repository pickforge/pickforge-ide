// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
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

  setUp(() {
    settings = _ProjectSettingsRepo();
    terminal = _TerminalSettingsRepo();
    discovery = _DeviceDiscovery();
    diagnosticsRunner = _DiagnosticsRunner();
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
    ).thenAnswer((_) async => ProcessResult(1, 0, '', ''));
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
              diagnosticsService: DiagnosticsService(diagnosticsRunner),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    verify(() => settings.getDefaultAgentId('/workspace/app')).called(1);
    verify(() => settings.getRunArgs('/workspace/app')).called(1);
    expect(find.text('Diagnostics'), findsOneWidget);
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
