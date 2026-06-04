import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_cubit.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_state.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';
import 'package:pickforge/features/workbench/view/project_file_explorer_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

import '../../../support/deterministic_workspace_fixtures.dart';

class _SettingsRepo extends Mock implements ProjectSettingsRepository {}

class _TerminalSettingsRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

class _DeviceDiscovery extends Mock implements DeviceDiscoveryService {}

class _DiagnosticsRunner extends Mock implements ProcessRunner {}

class _AgentLauncher extends Mock implements AgentLauncher {}

class _AdbCapturer extends Mock implements AdbScreenshotCapturer {}

void main() {
  testWidgets('workbench icon-only controls expose semantic labels',
      (tester) async {
    final semantics = tester.ensureSemantics();
    try {
      final sidebar = await _pumpSidebar(tester);
      expect(find.byTooltip('Add project'), findsOneWidget);
      expect(find.byTooltip('List'), findsOneWidget);
      expect(find.byTooltip('Grid'), findsOneWidget);
      expect(find.byTooltip('Comfortable density'), findsOneWidget);

      when(
        () => sidebar.chats.newChat(
          projectRoot: any(named: 'projectRoot'),
          defaultAgentId: any(named: 'defaultAgentId'),
          skillId: any(named: 'skillId'),
        ),
      ).thenAnswer((_) async => 'new-chat');
      await tester.tap(find.byTooltip('New chat').first);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);

      await _exerciseTabTraversal(tester, minimumUniqueFocusNodes: 2);

      await _pumpExplorer(tester);
      expect(find.byTooltip('Show hidden files'), findsOneWidget);
      expect(find.byTooltip('Refresh'), findsOneWidget);
      expect(find.byTooltip('Show menu'), findsWidgets);
      await _exerciseTabTraversal(tester, minimumUniqueFocusNodes: 2);

      await _pumpInspector(tester);
      expect(find.byTooltip('Inspect active skill source'), findsOneWidget);
      await _exerciseTabTraversal(tester, minimumUniqueFocusNodes: 2);

      await _pumpSettings(tester);
      expect(find.byTooltip('Copy error details'), findsOneWidget);
      await _exerciseTabTraversal(tester, minimumUniqueFocusNodes: 2);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('primary workbench panels tolerate larger text scaling',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    const textScaler = TextScaler.linear(1.6);
    await _pumpSidebar(tester, textScaler: textScaler);
    expect(tester.takeException(), isNull);

    await _pumpExplorer(tester, textScaler: textScaler);
    expect(tester.takeException(), isNull);

    await _pumpInspector(tester, textScaler: textScaler);
    expect(tester.takeException(), isNull);

    await _pumpSettings(tester, textScaler: textScaler);
    expect(tester.takeException(), isNull);
  });
}

Future<DeterministicSidebarFixture> _pumpSidebar(
  WidgetTester tester, {
  TextScaler? textScaler,
}) async {
  final fixture = await deterministicSidebarFixture(
    WorkspaceSidebarSettings.defaults,
  );
  await tester.pumpWidget(
    _app(
      textScaler: textScaler,
      child: MultiBlocProvider(
        providers: [
          BlocProvider<ProjectsCubit>.value(value: fixture.projects),
          BlocProvider<ChatsCubit>.value(value: fixture.chats),
          BlocProvider<WorkspaceSidebarCubit>.value(value: fixture.sidebar),
        ],
        child: const ProjectsChatsPanel(
          gitignoreHelper: DeterministicGitignoreDialogHelper(),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return fixture;
}

Future<void> _pumpExplorer(
  WidgetTester tester, {
  TextScaler? textScaler,
}) async {
  final cubit = ProjectFileExplorerCubit(
    projectRoot: deterministicAlphaRoot,
    scanner: const DeterministicProjectFileScanner(deterministicFileTree),
    opener: ProjectFileOpener(runner: const NoopEmulatorProcessRunner()),
  );
  addTearDown(cubit.close);
  await cubit.load();
  cubit.toggleExpanded('$deterministicAlphaRoot/lib');
  await tester.pumpWidget(
    _app(
      textScaler: textScaler,
      child: BlocProvider<ProjectFileExplorerCubit>.value(
        value: cubit,
        child: const ProjectFileExplorerPanel(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpInspector(
  WidgetTester tester, {
  TextScaler? textScaler,
}) async {
  await tester.pumpWidget(
    _app(
      width: 520,
      textScaler: textScaler,
      child: MultiBlocProvider(
        providers: [
          BlocProvider<ProjectsCubit>.value(
            value: DeterministicProjectsCubit(
              ProjectsReady(
                projects: [
                  deterministicProject(deterministicAlphaRoot, 'alpha_app'),
                ],
                activeProjectRoot: deterministicAlphaRoot,
              ),
            ),
          ),
          BlocProvider<ChatsCubit>.value(
            value: DeterministicChatsCubit(
              ChatsReady(
                chatsByProject: {
                  deterministicAlphaRoot: [
                    deterministicChat(
                      'chat-1',
                      deterministicAlphaRoot,
                      'Forge selected widget',
                    ),
                  ],
                },
                expanded: const {deterministicAlphaRoot},
                activeChatId: 'chat-1',
              ),
            ),
          ),
          BlocProvider<WidgetPickerCubit>.value(
            value: DeterministicWidgetPickerCubit(
              const WidgetPickerState(
                selection: deterministicSelectedWidget,
                selectModeEnabled: true,
                latestRebuildStats: null,
              ),
            ),
          ),
          BlocProvider<ForgeCubit>(
            create: (_) => ForgeCubit(
              _AgentLauncher(),
              _AdbCapturer(),
              PtySessionPool(),
            ),
          ),
        ],
        child: const InspectorPanel(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpSettings(
  WidgetTester tester, {
  TextScaler? textScaler,
}) async {
  final settings = _SettingsRepo();
  final terminal = _TerminalSettingsRepo();
  final discovery = _DeviceDiscovery();
  final diagnosticsRunner = _DiagnosticsRunner();
  when(
    () => diagnosticsRunner.run(
      any(),
      any(),
      cwd: any(named: 'cwd'),
      env: any(named: 'env'),
    ),
  ).thenAnswer((_) async => ProcessResult(0, 0, '', ''));
  stubDeterministicDeviceSettings(
    settings: settings,
    terminal: terminal,
    discovery: discovery,
  );
  final diagnostics = DiagnosticsService(diagnosticsRunner)
    ..recordVmError('SocketException: token=secret');
  await tester.pumpWidget(
    _app(
      width: 720,
      textScaler: textScaler,
      child: BlocProvider<ProjectsCubit>.value(
        value: DeterministicProjectsCubit(
          ProjectsReady(
            projects: [
              deterministicProject(deterministicAlphaRoot, 'alpha_app'),
            ],
            activeProjectRoot: deterministicAlphaRoot,
          ),
        ),
        child: SettingsView(
          settingsCubit: SettingsCubit(settings, terminal),
          deviceRunSettingsCubit: DeviceRunSettingsCubit(
            settings: settings,
            discovery: discovery,
            targetScanner: const DeterministicRunTargetScanner(),
          ),
          diagnosticsService: diagnostics,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Widget _app({
  required Widget child,
  TextScaler? textScaler,
  double width = 420,
}) {
  Widget body = Center(
    child: SizedBox(
      width: width,
      height: 760,
      child: child,
    ),
  );
  if (textScaler != null) {
    body = MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: body,
    );
  }
  return MaterialApp(
    theme: PickforgeTheme.dark(),
    darkTheme: PickforgeTheme.dark(),
    themeMode: ThemeMode.dark,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: body),
  );
}

Future<void> _exerciseTabTraversal(
  WidgetTester tester, {
  required int minimumUniqueFocusNodes,
}) async {
  final visited = <FocusNode>{};
  for (var index = 0; index < 8; index++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final focused = FocusManager.instance.primaryFocus;
    if (focused != null) visited.add(focused);
  }
  expect(visited.length, greaterThanOrEqualTo(minimumUniqueFocusNodes));
}
