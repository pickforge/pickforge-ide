// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/emulator/process_runner.dart'
    as emulator_process;
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/projects/gitignore_helper.dart';
import 'package:pickforge/core/projects/project_file_tree.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/flutter_run_target_scanner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_cubit.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_state.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';

const deterministicAlphaRoot = '/workspace/alpha_app';
const deterministicDesignRoot = '/workspace/design_system';
const deterministicShopRoot = '/workspace/shop_admin';

class DeterministicProjectsCubit extends Cubit<ProjectsState>
    with Mock
    implements ProjectsCubit {
  DeterministicProjectsCubit(super.initialState);
}

class DeterministicChatsCubit extends Cubit<ChatsState>
    with Mock
    implements ChatsCubit {
  DeterministicChatsCubit(super.initialState);
}

class DeterministicWidgetPickerCubit extends Cubit<WidgetPickerState>
    with Mock
    implements WidgetPickerCubit {
  DeterministicWidgetPickerCubit(super.initialState);
}

class DeterministicSidebarSettingsRepository
    implements WorkspaceSidebarSettingsRepository {
  DeterministicSidebarSettingsRepository(this.settings);

  WorkspaceSidebarSettings settings;

  @override
  Future<WorkspaceSidebarSettings> load() async => settings;

  @override
  Future<void> save(WorkspaceSidebarSettings settings) async {
    this.settings = settings;
  }
}

class DeterministicProjectFileScanner extends ProjectFileTreeScanner {
  const DeterministicProjectFileScanner(this.nodes);

  final List<ProjectFileNode> nodes;

  @override
  Future<List<ProjectFileNode>> scan(
    String projectRoot, {
    bool showHidden = false,
  }) async =>
      nodes;
}

class NoopEmulatorProcessRunner implements emulator_process.ProcessRunner {
  const NoopEmulatorProcessRunner();

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

class DeterministicRunTargetScanner extends FlutterRunTargetScanner {
  const DeterministicRunTargetScanner();

  @override
  Future<FlutterRunMetadata> scan(String projectRoot) async {
    return const FlutterRunMetadata(
      targetFiles: ['lib/main.dart', 'lib/main_staging.dart'],
      flavors: ['staging'],
    );
  }
}

class DeterministicGitignoreDialogHelper extends GitignoreHelper {
  const DeterministicGitignoreDialogHelper();

  @override
  Future<bool> needsEntry(String projectRoot) async => true;

  @override
  Future<void> appendEntry(String projectRoot) async {}
}

class DeterministicSidebarFixture {
  const DeterministicSidebarFixture({
    required this.projects,
    required this.chats,
    required this.sidebar,
  });

  final DeterministicProjectsCubit projects;
  final DeterministicChatsCubit chats;
  final WorkspaceSidebarCubit sidebar;
}

ProjectRow deterministicProject(String root, String name) => ProjectRow(
      projectRoot: root,
      displayName: name,
      createdAt: DateTime(2026, 6, 4, 9),
      lastOpenedAt: DateTime(2026, 6, 4, 10),
      sortOrder: 0,
    );

ChatRow deterministicChat(String id, String root, String title) => ChatRow(
      chatId: id,
      projectRoot: root,
      title: title,
      agentId: 'codex',
      createdAt: DateTime(2026, 6, 4, 9),
      lastActivityAt: DateTime(2026, 6, 4, 10),
      sortOrder: 0,
    );

Future<DeterministicSidebarFixture> deterministicSidebarFixture(
  WorkspaceSidebarSettings settings,
) async {
  final projects = [
    deterministicProject(deterministicAlphaRoot, 'alpha_app'),
    deterministicProject(deterministicDesignRoot, 'design_system'),
    deterministicProject(deterministicShopRoot, 'shop_admin'),
  ];
  final chatsByProject = {
    deterministicAlphaRoot: [
      deterministicChat(
        'alpha-ui',
        deterministicAlphaRoot,
        'Refine picker overlay',
      ),
      deterministicChat(
        'alpha-terminal',
        deterministicAlphaRoot,
        'Terminal prompt audit',
      ),
    ],
    deterministicDesignRoot: [
      deterministicChat(
        'design-colors',
        deterministicDesignRoot,
        'Color token pass',
      ),
      deterministicChat(
        'design-density',
        deterministicDesignRoot,
        'Density review',
      ),
    ],
    deterministicShopRoot: [
      deterministicChat('shop-run', deterministicShopRoot, 'Run flow cleanup'),
    ],
  };
  final sidebar = WorkspaceSidebarCubit(
    DeterministicSidebarSettingsRepository(settings),
  );
  await sidebar.load();
  return DeterministicSidebarFixture(
    projects: DeterministicProjectsCubit(
      ProjectsReady(
        projects: projects,
        activeProjectRoot: deterministicAlphaRoot,
      ),
    ),
    chats: DeterministicChatsCubit(
      ChatsReady(
        chatsByProject: chatsByProject,
        expanded: const {
          deterministicAlphaRoot,
          deterministicDesignRoot,
          deterministicShopRoot,
        },
        activeChatId: 'alpha-ui',
      ),
    ),
    sidebar: sidebar,
  );
}

void stubDeterministicDeviceSettings({
  required ProjectSettingsRepository settings,
  required EmbeddedTerminalSettingsRepository terminal,
  required DeviceDiscoveryService discovery,
}) {
  when(() => settings.getDefaultAgentId(any()))
      .thenAnswer((_) async => 'codex');
  when(() => settings.getValidatorCommand(any())).thenAnswer((_) async => null);
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
    (_) async => const EmulatorIdleShutdownSettings(enabled: true),
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

const deterministicSelectedWidget = SelectedWidget(
  node: WidgetNode(
    id: 'widget-1',
    className: 'PrimaryActionButton',
    children: [],
    creationLocation: CreationLocation(
      file: '$deterministicAlphaRoot/lib/main.dart',
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

const deterministicFileTree = [
  ProjectFileNode(
    path: '$deterministicAlphaRoot/lib',
    relativePath: 'lib',
    name: 'lib',
    isDirectory: true,
    children: [
      ProjectFileNode(
        path: '$deterministicAlphaRoot/lib/main.dart',
        relativePath: 'lib/main.dart',
        name: 'main.dart',
        isDirectory: false,
      ),
      ProjectFileNode(
        path: '$deterministicAlphaRoot/lib/features',
        relativePath: 'lib/features',
        name: 'features',
        isDirectory: true,
        children: [
          ProjectFileNode(
            path: '$deterministicAlphaRoot/lib/features/workbench',
            relativePath: 'lib/features/workbench',
            name: 'workbench',
            isDirectory: true,
            children: [
              ProjectFileNode(
                path:
                    '$deterministicAlphaRoot/lib/features/workbench/sidebar.dart',
                relativePath: 'lib/features/workbench/sidebar.dart',
                name: 'sidebar.dart',
                isDirectory: false,
              ),
            ],
          ),
          ProjectFileNode(
            path: '$deterministicAlphaRoot/lib/features/settings',
            relativePath: 'lib/features/settings',
            name: 'settings',
            isDirectory: true,
            children: [
              ProjectFileNode(
                path:
                    '$deterministicAlphaRoot/lib/features/settings/settings_view.dart',
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
    path: '$deterministicAlphaRoot/test',
    relativePath: 'test',
    name: 'test',
    isDirectory: true,
    children: [
      ProjectFileNode(
        path: '$deterministicAlphaRoot/test/widget_test.dart',
        relativePath: 'test/widget_test.dart',
        name: 'widget_test.dart',
        isDirectory: false,
      ),
    ],
  ),
  ProjectFileNode(
    path: '$deterministicAlphaRoot/pubspec.yaml',
    relativePath: 'pubspec.yaml',
    name: 'pubspec.yaml',
    isDirectory: false,
  ),
];
