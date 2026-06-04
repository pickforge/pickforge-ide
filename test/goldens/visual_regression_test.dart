// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/emulator/process_runner.dart'
    as emulator_process;
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/projects/gitignore_helper.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/projects/project_file_tree.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/flutter_run_target_scanner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
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

import '../support/golden_test_harness.dart';

class _ProjectsCubit extends Cubit<ProjectsState>
    with Mock
    implements ProjectsCubit {
  _ProjectsCubit(super.initialState);
}

class _ChatsCubit extends Cubit<ChatsState> with Mock implements ChatsCubit {
  _ChatsCubit(super.initialState);
}

class _WidgetPickerCubit extends Cubit<WidgetPickerState>
    with Mock
    implements WidgetPickerCubit {
  _WidgetPickerCubit(super.initialState);
}

class _SettingsRepo extends Mock implements ProjectSettingsRepository {}

class _TerminalSettingsRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

class _DeviceDiscovery extends Mock implements DeviceDiscoveryService {}

class _AgentLauncher extends Mock implements AgentLauncher {}

class _AdbCapturer extends Mock implements AdbScreenshotCapturer {}

class _FakeSidebarSettingsRepository
    implements WorkspaceSidebarSettingsRepository {
  _FakeSidebarSettingsRepository(this.settings);

  WorkspaceSidebarSettings settings;

  @override
  Future<WorkspaceSidebarSettings> load() async => settings;

  @override
  Future<void> save(WorkspaceSidebarSettings settings) async {
    this.settings = settings;
  }
}

class _FakeProjectFileScanner extends ProjectFileTreeScanner {
  const _FakeProjectFileScanner(this.nodes);

  final List<ProjectFileNode> nodes;

  @override
  Future<List<ProjectFileNode>> scan(
    String projectRoot, {
    bool showHidden = false,
  }) async =>
      nodes;
}

class _NoopProcessRunner implements emulator_process.ProcessRunner {
  const _NoopProcessRunner();

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async =>
      ProcessResult(0, 0, '', '');

  @override
  Future<emulator_process.RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}

class _FakeRunTargetScanner extends FlutterRunTargetScanner {
  const _FakeRunTargetScanner();

  @override
  Future<FlutterRunMetadata> scan(String projectRoot) async {
    return const FlutterRunMetadata(
      targetFiles: ['lib/main.dart', 'lib/main_staging.dart'],
      flavors: ['staging'],
    );
  }
}

class _GitignoreDialogHelper extends GitignoreHelper {
  const _GitignoreDialogHelper();

  @override
  Future<bool> needsEntry(String projectRoot) async => true;

  @override
  Future<void> appendEntry(String projectRoot) async {}
}

ProjectRow _project(String root, String name) => ProjectRow(
      projectRoot: root,
      displayName: name,
      createdAt: DateTime(2026, 6, 4, 9),
      lastOpenedAt: DateTime(2026, 6, 4, 10),
      sortOrder: 0,
    );

ChatRow _chat(String id, String root, String title) => ChatRow(
      chatId: id,
      projectRoot: root,
      title: title,
      agentId: 'codex',
      createdAt: DateTime(2026, 6, 4, 9),
      lastActivityAt: DateTime(2026, 6, 4, 10),
      sortOrder: 0,
    );

const _selectedWidget = SelectedWidget(
  node: WidgetNode(
    id: 'widget-1',
    className: 'PrimaryActionButton',
    children: [],
    creationLocation: CreationLocation(
      file: '/workspace/alpha_app/lib/main.dart',
      line: 42,
      column: 13,
    ),
  ),
  ancestorClasses: ['MaterialApp', 'Scaffold', 'CheckoutView'],
  sourceSnippet: '''
FilledButton.icon(
  onPressed: submitOrder,
  icon: const Icon(Icons.flash_on),
  label: const Text('Forge order'),
)''',
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {
    'enabled': true,
    'tooltip': 'Submit checkout flow',
  },
);

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
          value: _ProjectsCubit(const ProjectsReady(projects: [])),
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
      final fixture = await _sidebarFixture(
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
      final fixture = await _sidebarFixture(
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
        projectRoot: '/workspace/alpha_app',
        scanner: const _FakeProjectFileScanner(_fileTree),
        opener: ProjectFileOpener(runner: const _NoopProcessRunner()),
      );
      addTearDown(cubit.close);
      await cubit.load();
      cubit
        ..toggleExpanded('/workspace/alpha_app/lib')
        ..toggleExpanded('/workspace/alpha_app/lib/features');

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
            picker: _WidgetPickerCubit(WidgetPickerState.initial()),
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
            picker: _WidgetPickerCubit(
              const WidgetPickerState(
                selection: _selectedWidget,
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
      _stubSettings(settings, terminal, discovery);
      final settingsCubit = SettingsCubit(settings, terminal);
      final deviceRunCubit = DeviceRunSettingsCubit(
        settings: settings,
        discovery: discovery,
        targetScanner: const _FakeRunTargetScanner(),
      );

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        child: BlocProvider<ProjectsCubit>.value(
          value: _ProjectsCubit(
            ProjectsReady(
              projects: [_project('/workspace/alpha_app', 'alpha_app')],
              activeProjectRoot: '/workspace/alpha_app',
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
      final fixture = await _sidebarFixture(
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
            gitignoreHelper: _GitignoreDialogHelper(),
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

class _SidebarFixture {
  const _SidebarFixture({
    required this.projects,
    required this.chats,
    required this.sidebar,
  });

  final _ProjectsCubit projects;
  final _ChatsCubit chats;
  final WorkspaceSidebarCubit sidebar;
}

Future<_SidebarFixture> _sidebarFixture(
  WorkspaceSidebarSettings settings,
) async {
  const alpha = '/workspace/alpha_app';
  const design = '/workspace/design_system';
  const shop = '/workspace/shop_admin';
  final projects = [
    _project(alpha, 'alpha_app'),
    _project(design, 'design_system'),
    _project(shop, 'shop_admin'),
  ];
  final chatsByProject = {
    alpha: [
      _chat('alpha-ui', alpha, 'Refine picker overlay'),
      _chat('alpha-terminal', alpha, 'Terminal prompt audit'),
    ],
    design: [
      _chat('design-colors', design, 'Color token pass'),
      _chat('design-density', design, 'Density review'),
    ],
    shop: [
      _chat('shop-run', shop, 'Run flow cleanup'),
    ],
  };
  final sidebar =
      WorkspaceSidebarCubit(_FakeSidebarSettingsRepository(settings));
  await sidebar.load();
  return _SidebarFixture(
    projects: _ProjectsCubit(
      ProjectsReady(projects: projects, activeProjectRoot: alpha),
    ),
    chats: _ChatsCubit(
      ChatsReady(
        chatsByProject: chatsByProject,
        expanded: const {alpha, design, shop},
        activeChatId: 'alpha-ui',
      ),
    ),
    sidebar: sidebar,
  );
}

Widget _inspectorProviders({
  required _WidgetPickerCubit picker,
  required Widget child,
  bool includeForge = true,
}) {
  const projectRoot = '/workspace/alpha_app';
  final providers = <BlocProvider>[
    BlocProvider<ProjectsCubit>.value(
      value: _ProjectsCubit(
        ProjectsReady(
          projects: [_project(projectRoot, 'alpha_app')],
          activeProjectRoot: projectRoot,
        ),
      ),
    ),
    BlocProvider<ChatsCubit>.value(
      value: _ChatsCubit(
        ChatsReady(
          chatsByProject: {
            projectRoot: [
              _chat('chat-1', projectRoot, 'Forge selected widget'),
            ],
          },
          expanded: const {projectRoot},
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

void _stubSettings(
  _SettingsRepo settings,
  _TerminalSettingsRepo terminal,
  _DeviceDiscovery discovery,
) {
  when(() => settings.getDefaultAgentId(any()))
      .thenAnswer((_) async => 'codex');
  when(() => terminal.load()).thenAnswer(
    (_) async => const EmbeddedTerminalSettings(
      fontFamily: 'JetBrainsMono',
      fontSize: 13,
      themeId: TerminalThemeId.pickforgeEmber,
    ),
  );
  when(() => settings.getEmulatorBinding(any())).thenAnswer(
    (_) async => const EmulatorBinding.avd(
      avdId: 'Pixel_10',
      avdName: 'Pixel 10',
    ),
  );
  when(() => settings.getRunArgs(any())).thenAnswer(
    (_) async => const RunArgs(
      targetFile: 'lib/main_staging.dart',
      extraArgs: ['--flavor', 'staging', '--dart-define=APP_ENV=staging'],
    ),
  );
  when(() => settings.getEmulatorLaunchOptions(any())).thenAnswer(
    (_) async => const EmulatorLaunchOptions(
      noAudio: true,
      noSnapshotLoad: true,
      gpuMode: EmulatorGpuMode.host,
      port: 5554,
      cores: 4,
    ),
  );
  when(() => settings.getEmulatorIdleShutdownSettings(any())).thenAnswer(
    (_) async => const EmulatorIdleShutdownSettings(
      enabled: true,
    ),
  );
  when(discovery.snapshot).thenAnswer(
    (_) async => const DeviceListSnapshot(
      avds: [
        Avd(
          id: 'Pixel_10',
          name: 'Pixel 10',
          platform: androidEmulatorPlatform,
        ),
      ],
      running: [
        RunningAndroidDevice(
          serial: 'emulator-5554',
          avdName: 'Pixel_10',
          state: 'device',
        ),
      ],
    ),
  );
}

const _fileTree = [
  ProjectFileNode(
    path: '/workspace/alpha_app/lib',
    relativePath: 'lib',
    name: 'lib',
    isDirectory: true,
    children: [
      ProjectFileNode(
        path: '/workspace/alpha_app/lib/main.dart',
        relativePath: 'lib/main.dart',
        name: 'main.dart',
        isDirectory: false,
      ),
      ProjectFileNode(
        path: '/workspace/alpha_app/lib/features',
        relativePath: 'lib/features',
        name: 'features',
        isDirectory: true,
        children: [
          ProjectFileNode(
            path: '/workspace/alpha_app/lib/features/workbench',
            relativePath: 'lib/features/workbench',
            name: 'workbench',
            isDirectory: true,
            children: [
              ProjectFileNode(
                path:
                    '/workspace/alpha_app/lib/features/workbench/sidebar.dart',
                relativePath: 'lib/features/workbench/sidebar.dart',
                name: 'sidebar.dart',
                isDirectory: false,
              ),
            ],
          ),
          ProjectFileNode(
            path: '/workspace/alpha_app/lib/features/settings',
            relativePath: 'lib/features/settings',
            name: 'settings',
            isDirectory: true,
            children: [
              ProjectFileNode(
                path:
                    '/workspace/alpha_app/lib/features/settings/settings_view.dart',
                relativePath: 'lib/features/settings/settings_view.dart',
                name: 'settings_view.dart',
                isDirectory: false,
              ),
            ],
          ),
        ],
      ),
    ],
  ),
  ProjectFileNode(
    path: '/workspace/alpha_app/test',
    relativePath: 'test',
    name: 'test',
    isDirectory: true,
    children: [
      ProjectFileNode(
        path: '/workspace/alpha_app/test/widget_test.dart',
        relativePath: 'test/widget_test.dart',
        name: 'widget_test.dart',
        isDirectory: false,
      ),
    ],
  ),
  ProjectFileNode(
    path: '/workspace/alpha_app/pubspec.yaml',
    relativePath: 'pubspec.yaml',
    name: 'pubspec.yaml',
    isDirectory: false,
  ),
];
