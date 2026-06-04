import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
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
import 'package:pickforge/features/workbench/view/demo_workspace_view.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';
import 'package:pickforge/features/workbench/view/onboarding_view.dart';
import 'package:pickforge/features/workbench/view/project_file_explorer_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';

import '../support/deterministic_workspace_fixtures.dart';
import '../support/golden_test_harness.dart';

class _SettingsRepo extends Mock implements ProjectSettingsRepository {}

class _TerminalSettingsRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

class _DeviceDiscovery extends Mock implements DeviceDiscoveryService {}

class _AgentLauncher extends Mock implements AgentLauncher {}

class _AdbCapturer extends Mock implements AdbScreenshotCapturer {}

void main() {
  setUpAll(loadGoldenFonts);

  setUp(() async {
    await getIt.reset();
  });

  tearDown(() async {
    await getIt.reset();
  });

  testWidgets(
    'onboarding matches golden',
    (tester) async {
      const key = ValueKey('onboarding-golden');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: BlocProvider<ProjectsCubit>.value(
          value: DeterministicProjectsCubit(
            const ProjectsReady(projects: []),
          ),
          child: OnboardingView(
            pickFolder: () async => null,
            dismissOnboarding: () async {},
            openDemoWorkspace: () {},
            openSettings: () {},
          ),
        ),
      );

      await expectGolden(key, 'onboarding');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'sidebar list mode matches golden',
    (tester) async {
      const key = ValueKey('sidebar-list-golden');
      final fixture = await deterministicSidebarFixture(
        const WorkspaceSidebarSettings(
          pinnedProjectRoots: {'/workspace/alpha_app'},
          pinnedChatIds: {'alpha-ui'},
        ),
      );

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: _pane(
          width: 340,
          child: MultiBlocProvider(
            providers: [
              BlocProvider<ProjectsCubit>.value(value: fixture.projects),
              BlocProvider<ChatsCubit>.value(value: fixture.chats),
              BlocProvider<WorkspaceSidebarCubit>.value(
                value: fixture.sidebar,
              ),
            ],
            child: const ProjectsChatsPanel(),
          ),
        ),
      );

      await expectGolden(key, 'sidebar_list');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'sidebar grid mode matches golden',
    (tester) async {
      const key = ValueKey('sidebar-grid-golden');
      final fixture = await deterministicSidebarFixture(
        const WorkspaceSidebarSettings(
          viewMode: WorkspaceSidebarViewMode.grid,
          groupingMode: WorkspaceSidebarGroupingMode.custom,
          customChatGroups: {
            'alpha-ui': 'UI polish',
            'design-colors': 'UI polish',
            'shop-run': 'Release',
          },
        ),
      );

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: _pane(
          width: 420,
          child: MultiBlocProvider(
            providers: [
              BlocProvider<ProjectsCubit>.value(value: fixture.projects),
              BlocProvider<ChatsCubit>.value(value: fixture.chats),
              BlocProvider<WorkspaceSidebarCubit>.value(
                value: fixture.sidebar,
              ),
            ],
            child: const ProjectsChatsPanel(),
          ),
        ),
      );

      await expectGolden(key, 'sidebar_grid');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'project file explorer matches golden',
    (tester) async {
      const key = ValueKey('file-explorer-golden');
      final cubit = ProjectFileExplorerCubit(
        projectRoot: deterministicAlphaRoot,
        scanner: const DeterministicProjectFileScanner(deterministicFileTree),
        opener: ProjectFileOpener(runner: const NoopEmulatorProcessRunner()),
      );
      addTearDown(cubit.close);
      await cubit.load();
      cubit
        ..toggleExpanded('$deterministicAlphaRoot/lib')
        ..toggleExpanded('$deterministicAlphaRoot/lib/features');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: _pane(
          width: 360,
          child: BlocProvider<ProjectFileExplorerCubit>.value(
            value: cubit,
            child: const ProjectFileExplorerPanel(),
          ),
        ),
      );

      await expectGolden(key, 'file_explorer');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'terminal pane matches golden',
    (tester) async {
      const key = ValueKey('terminal-golden');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        size: const Size(1200, 700),
        child: const DemoWorkspaceView(),
      );

      await expectGolden(key, 'terminal_demo_workspace');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'inspector empty state matches golden',
    (tester) async {
      const key = ValueKey('inspector-empty-golden');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: _pane(
          width: 360,
          child: _inspectorProviders(
            picker: DeterministicWidgetPickerCubit(
              WidgetPickerState.initial(),
            ),
            child: const InspectorPanel(),
          ),
        ),
      );

      await expectGolden(key, 'inspector_empty');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'inspector selected state matches golden',
    (tester) async {
      const key = ValueKey('inspector-selected-golden');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: _pane(
          width: 430,
          child: _inspectorProviders(
            picker: DeterministicWidgetPickerCubit(
              const WidgetPickerState(
                selection: deterministicSelectedWidget,
                selectModeEnabled: true,
                latestRebuildStats: RebuildStats(
                  frameNumber: 12,
                  startTime: 1500,
                  widgets: [
                    RebuiltWidget(
                      className: 'PrimaryActionButton',
                      location: CreationLocation(
                        file: '/workspace/alpha_app/lib/main.dart',
                        line: 42,
                        column: 13,
                      ),
                      count: 5,
                    ),
                  ],
                ),
              ),
            ),
            child: const InspectorPanel(),
          ),
        ),
      );

      await expectGolden(key, 'inspector_selected');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'settings matches golden',
    (tester) async {
      const key = ValueKey('settings-golden');
      final settings = _SettingsRepo();
      final terminal = _TerminalSettingsRepo();
      final discovery = _DeviceDiscovery();
      stubDeterministicDeviceSettings(
        settings: settings,
        terminal: terminal,
        discovery: discovery,
      );
      final settingsCubit = SettingsCubit(settings, terminal);
      final deviceRunCubit = DeviceRunSettingsCubit(
        settings: settings,
        discovery: discovery,
        targetScanner: const DeterministicRunTargetScanner(),
      );

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
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
            settingsCubit: settingsCubit,
            deviceRunSettingsCubit: deviceRunCubit,
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));

      await expectGolden(key, 'settings');
    },
    skip: skipGoldenPlatform,
  );

  testWidgets(
    'gitignore confirmation dialog matches golden',
    (tester) async {
      const key = ValueKey('dialog-golden');
      final fixture = await deterministicSidebarFixture(
        WorkspaceSidebarSettings.defaults,
      );
      when(
        () => fixture.chats.newChat(
          projectRoot: any(named: 'projectRoot'),
          defaultAgentId: any(named: 'defaultAgentId'),
          skillId: any(named: 'skillId'),
        ),
      ).thenAnswer((_) async => 'new-chat');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
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
      );

      await tester.tap(find.byTooltip('New chat').first);
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsOneWidget);
      await expectLater(
        find.byType(AlertDialog),
        matchesGoldenFile('baselines/gitignore_dialog.png'),
      );
    },
    skip: skipGoldenPlatform,
  );
}

Widget _pane({
  required double width,
  required Widget child,
}) {
  return Align(
    alignment: Alignment.topLeft,
    child: SizedBox(
      width: width,
      height: goldenSurfaceSize.height,
      child: child,
    ),
  );
}

Widget _inspectorProviders({
  required DeterministicWidgetPickerCubit picker,
  required Widget child,
  bool includeForge = true,
}) {
  final providers = <BlocProvider>[
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
    BlocProvider<WidgetPickerCubit>.value(value: picker),
    if (includeForge)
      BlocProvider<ForgeCubit>(
        create: (_) => ForgeCubit(
          _AgentLauncher(),
          _AdbCapturer(),
          PtySessionPool(),
        ),
      ),
  ];
  return MultiBlocProvider(providers: providers, child: child);
}
