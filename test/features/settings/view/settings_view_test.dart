// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_migrator.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/context_storage_settings.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
  late UpdateCheckSettingsRepository updates;
  late TelemetrySettingsRepository telemetry;
  late ContextStorageService storage;
  const migrator = ContextStorageMigrator();
  String? clipboardText;

  SettingsCubit buildSettingsCubit() =>
      SettingsCubit(settings, terminal, storage, migrator);

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    settings = _ProjectSettingsRepo();
    terminal = _TerminalSettingsRepo();
    discovery = _DeviceDiscovery();
    diagnosticsRunner = _DiagnosticsRunner();
    updates = UpdateCheckSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    telemetry = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );
    storage = ContextStorageService.forTesting(
      environment: const {'HOME': '/home/forge'},
      isWindows: false,
      settings: settings,
    );
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
    when(() => settings.getValidatorCommand(any()))
        .thenAnswer((_) async => null);
    when(() => settings.getContextStorageLocation(any()))
        .thenAnswer((_) async => null);
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
    final settingsCubit = buildSettingsCubit();
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
              updateSettingsRepository: updates,
              telemetrySettingsRepository: telemetry,
              diagnosticsService: DiagnosticsService(
                diagnosticsRunner,
                appVersion: '9.8.7+6',
                buildMetadata: const DiagnosticsBuildMetadata(
                  commitSha: 'abc123',
                  refName: 'main',
                  workflow: 'CI',
                  runId: '987654321',
                  runNumber: '42',
                  buildUrl: 'https://example.test/build/42',
                ),
              )
                ..recordVmError('SocketException: apiKey=secret')
                ..recordRunError('Run failed: token=secret')
                ..recordAgentError('Agent failed: password=secret')
                ..recordPerformance(
                  'fileExplorer.scan',
                  const Duration(milliseconds: 42),
                ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    verify(() => settings.getDefaultAgentId('/workspace/app')).called(1);
    verify(() => settings.getValidatorCommand('/workspace/app')).called(1);
    verify(() => settings.getRunArgs('/workspace/app')).called(1);
    expect(find.text('PROJECT VALIDATOR'), findsOneWidget);
    expect(find.text('UPDATES'), findsOneWidget);
    expect(find.text('Check for updates'), findsOneWidget);
    expect(find.text('PRIVACY'), findsOneWidget);
    expect(find.text('Share anonymous diagnostics'), findsOneWidget);
    expect(find.text('DIAGNOSTICS'), findsOneWidget);
    expect(find.text('App version'), findsOneWidget);
    expect(find.text('9.8.7+6'), findsOneWidget);
    expect(find.text('Build commit'), findsOneWidget);
    expect(find.text('abc123'), findsOneWidget);
    expect(find.text('Build ref'), findsOneWidget);
    expect(find.text('main'), findsOneWidget);
    expect(find.text('Build workflow'), findsOneWidget);
    expect(find.text('CI'), findsOneWidget);
    expect(find.text('Build run'), findsOneWidget);
    expect(find.text('42 (987654321)'), findsOneWidget);
    expect(find.text('Build URL'), findsOneWidget);
    expect(find.text('https://example.test/build/42'), findsOneWidget);
    expect(find.text('Flutter 3.41.7 • channel stable'), findsOneWidget);
    expect(find.text('Last VM error'), findsOneWidget);
    expect(find.text('SocketException: apiKey=[REDACTED]'), findsNWidgets(2));
    expect(find.text('Recent failures'), findsOneWidget);
    expect(find.text('Connection'), findsOneWidget);
    expect(find.text('Run'), findsOneWidget);
    expect(find.text('Agent'), findsOneWidget);
    expect(find.text('Run failed: token=[REDACTED]'), findsOneWidget);
    expect(find.text('Agent failed: password=[REDACTED]'), findsOneWidget);
    expect(find.text('Performance counters'), findsOneWidget);
    expect(find.text('fileExplorer.scan'), findsOneWidget);
    expect(find.text('last 42ms, max 42ms, 1 sample'), findsOneWidget);

    final copyButton = find.byTooltip('Copy error details').first;
    await tester.ensureVisible(copyButton);
    await tester.pumpAndSettle();
    await tester.tap(copyButton);
    await tester.pump();

    expect(clipboardText, contains('Kind: connection'));
    expect(
      clipboardText,
      contains('SocketException: apiKey=[REDACTED]'),
    );
    expect(find.text('Error details copied'), findsOneWidget);
  });

  testWidgets('toggles update checks', (tester) async {
    final projectsCubit = _ProjectsCubit(
      ProjectsReady(
        projects: [_project('/workspace/app')],
        activeProjectRoot: '/workspace/app',
      ),
    );
    final settingsCubit = buildSettingsCubit();
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
              updateSettingsRepository: updates,
              telemetrySettingsRepository: telemetry,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect((await updates.load()).enabled, isTrue);

    final toggle = find.byKey(const Key('update-check-enabled'));
    await tester.ensureVisible(toggle);
    await tester.pumpAndSettle();
    await tester.tap(toggle);
    await tester.pumpAndSettle();

    expect((await updates.load()).enabled, isFalse);
  });

  testWidgets('toggles telemetry setting', (tester) async {
    final projectsCubit = _ProjectsCubit(
      ProjectsReady(
        projects: [_project('/workspace/app')],
        activeProjectRoot: '/workspace/app',
      ),
    );
    final settingsCubit = buildSettingsCubit();
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
              telemetrySettingsRepository: telemetry,
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect((await telemetry.load()).enabled, isFalse);

    final toggle = find.byKey(const Key('telemetry-enabled'));
    await tester.ensureVisible(toggle);
    await tester.pumpAndSettle();
    await tester.tap(toggle);
    await tester.pumpAndSettle();

    expect((await telemetry.load()).enabled, isTrue);
  });

  testWidgets('saves project validator command', (tester) async {
    final projectsCubit = _ProjectsCubit(
      ProjectsReady(
        projects: [_project('/workspace/app')],
        activeProjectRoot: '/workspace/app',
      ),
    );
    when(() => settings.getValidatorCommand('/workspace/app'))
        .thenAnswer((_) async => 'fvm flutter analyze');
    when(
      () => settings.setValidatorCommand('/workspace/app', 'fvm flutter test'),
    ).thenAnswer((_) async {});
    final settingsCubit = buildSettingsCubit();
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
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(
      find.widgetWithText(TextField, 'fvm flutter analyze'),
      findsOneWidget,
    );

    await tester.enterText(
      find.widgetWithText(TextField, 'fvm flutter analyze'),
      'fvm flutter test',
    );
    // The page header pushed the validator section below the fold; scroll
    // it into view, then let the ballistic scroll activity finish (content
    // ignores pointers while it is running).
    await tester.dragUntilVisible(
      find.text('Save'),
      find.byType(SingleChildScrollView).first,
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pump();

    verify(
      () => settings.setValidatorCommand(
        '/workspace/app',
        'fvm flutter test',
      ),
    ).called(1);
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
              settingsCubit: buildSettingsCubit(),
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

  group('context storage section', () {
    late Directory project;

    setUp(() async {
      project = await Directory.systemTemp.createTemp('pf_project');
      storage = ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': project.path},
        isWindows: false,
        settings: settings,
      );
      when(() => settings.setContextStorageLocation(any(), any()))
          .thenAnswer((_) async {});
    });

    tearDown(() async {
      await project.delete(recursive: true);
    });

    void writeMarker(String root) {
      final dir = Directory(p.join(root, '.pickforge'))
        ..createSync(recursive: true);
      File(p.join(dir.path, '.gitignore')).writeAsStringSync('*\n');
    }

    Future<SettingsCubit> pumpStorage(
      WidgetTester tester, {
      Future<String?> Function()? pickFolder,
    }) async {
      final cubit = buildSettingsCubit();
      addTearDown(cubit.close);
      await cubit.load(project.path);
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: child ?? const SizedBox.shrink(),
          ),
          home: Scaffold(
            body: BlocProvider<SettingsCubit>.value(
              value: cubit,
              child: SingleChildScrollView(
                child: ContextStorageSettings(
                  projectRoot: project.path,
                  pickFolder: pickFolder ?? () async => null,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      return cubit;
    }

    testWidgets('home is selected for a clean project', (tester) async {
      await pumpStorage(tester);

      final segmented = tester.widget<SegmentedButton<ContextStorageMode>>(
        find.byKey(const Key('context-storage-mode')),
      );
      expect(segmented.selected, {ContextStorageMode.pickforgeHome});
      expect(find.text('CONTEXT STORAGE'), findsOneWidget);
    });

    testWidgets('project-local shows the repo-write warning', (tester) async {
      // Seed the persisted override so load() resolves straight into
      // project-local mode — no live switch, no copy dialog.
      writeMarker(project.path);
      when(() => settings.getContextStorageLocation(project.path))
          .thenAnswer((_) async => const ContextStorageLocation.projectLocal());

      await pumpStorage(tester);

      expect(
        find.text('Writes a .pickforge/ folder into the project repository.'),
        findsOneWidget,
      );
    });

    testWidgets('custom mode shows the chosen folder path', (tester) async {
      const customPath = '/tmp/pf-custom-fixture';
      when(() => settings.getContextStorageLocation(project.path)).thenAnswer(
        (_) async => const ContextStorageLocation.custom(customPath),
      );

      final cubit = buildSettingsCubit();
      addTearDown(cubit.close);
      await cubit.load(project.path);
      // The override resolves into custom mode at load.
      expect(cubit.state.contextStorageMode, ContextStorageMode.customPath);
      expect(cubit.state.contextStorageCustomPath, customPath);

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: child ?? const SizedBox.shrink(),
          ),
          home: Scaffold(
            body: BlocProvider<SettingsCubit>.value(
              value: cubit,
              child: SingleChildScrollView(
                child: ContextStorageSettings(
                  projectRoot: project.path,
                  pickFolder: () async => null,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const Key('context-storage-choose-folder')),
        findsOneWidget,
      );
      expect(find.text(customPath), findsOneWidget);
    });

    testWidgets('custom path inside the repo shows a warning', (tester) async {
      final inside = p.join(project.path, 'context-data');
      when(() => settings.getContextStorageLocation(project.path)).thenAnswer(
        (_) async => ContextStorageLocation.custom(inside),
      );

      final cubit = buildSettingsCubit();
      addTearDown(cubit.close);
      await cubit.load(project.path);
      expect(cubit.state.contextStorageMode, ContextStorageMode.customPath);

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: child ?? const SizedBox.shrink(),
          ),
          home: Scaffold(
            body: BlocProvider<SettingsCubit>.value(
              value: cubit,
              child: SingleChildScrollView(
                child: ContextStorageSettings(
                  projectRoot: project.path,
                  pickFolder: () async => null,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const Key('context-storage-custom-inside-repo')),
        findsOneWidget,
      );
    });

    testWidgets('custom path outside the repo shows no warning',
        (tester) async {
      const outside = '/tmp/pf-outside-fixture';
      when(() => settings.getContextStorageLocation(project.path)).thenAnswer(
        (_) async => const ContextStorageLocation.custom(outside),
      );

      final cubit = buildSettingsCubit();
      addTearDown(cubit.close);
      await cubit.load(project.path);
      expect(cubit.state.contextStorageMode, ContextStorageMode.customPath);

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: child ?? const SizedBox.shrink(),
          ),
          home: Scaffold(
            body: BlocProvider<SettingsCubit>.value(
              value: cubit,
              child: SingleChildScrollView(
                child: ContextStorageSettings(
                  projectRoot: project.path,
                  pickFolder: () async => null,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const Key('context-storage-custom-inside-repo')),
        findsNothing,
      );
    });
  });
}
