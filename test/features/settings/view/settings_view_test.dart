// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

class _ProjectsCubit extends Cubit<ProjectsState>
    with Mock
    implements ProjectsCubit {
  _ProjectsCubit(super.initialState);
}

class _ProjectSettingsRepo extends Mock implements ProjectSettingsRepository {}

class _TerminalSettingsRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

class _DeviceDiscovery extends Mock implements DeviceDiscoveryService {}

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

  setUp(() {
    settings = _ProjectSettingsRepo();
    terminal = _TerminalSettingsRepo();
    discovery = _DeviceDiscovery();
    when(() => terminal.load()).thenAnswer(
      (_) async => EmbeddedTerminalSettings.defaults,
    );
    when(() => settings.getDefaultAgentId(any())).thenAnswer((_) async => null);
    when(() => settings.getEmulatorBinding(any()))
        .thenAnswer((_) async => null);
    when(() => settings.getRunArgs(any()))
        .thenAnswer((_) async => const RunArgs());
    when(discovery.snapshot).thenAnswer(
      (_) async => const DeviceListSnapshot(avds: [], running: []),
    );
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
        home: BlocProvider<ProjectsCubit>.value(
          value: projectsCubit,
          child: Scaffold(
            body: SettingsView(
              settingsCubit: settingsCubit,
              deviceRunSettingsCubit: deviceRunCubit,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    verify(() => settings.getDefaultAgentId('/workspace/app')).called(1);
    verify(() => settings.getRunArgs('/workspace/app')).called(1);
  });

  testWidgets('shows empty state when no project is selected', (tester) async {
    final projectsCubit = _ProjectsCubit(const ProjectsReady(projects: []));

    await tester.pumpWidget(
      MaterialApp(
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
