import 'dart:io';

import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/di/injection.config.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/dao/run_session_log_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/process/binary_detector.dart' hide ProcessRunner;
import 'package:pickforge/core/skills/skill_store.dart';

final GetIt getIt = GetIt.instance;

@InjectableInit()
Future<void> configureDependencies() async {
  await getIt.init();
  if (!getIt.isRegistered<ProcessRunner>()) {
    getIt.registerSingleton<ProcessRunner>(RealProcessRunner());
  }
  if (!getIt.isRegistered<EmulatorIpcServer>()) {
    final socketPath = await _defaultIpcSocketPath();
    final server = EmulatorIpcServer(socketPath: socketPath);
    await server.start();
    getIt.registerSingleton<EmulatorIpcServer>(
      server,
      dispose: (server) => server.stop(),
    );
  }
}

Future<String> _defaultIpcSocketPath() async {
  final base =
      Platform.environment['XDG_RUNTIME_DIR'] ?? Directory.systemTemp.path;
  final dir = Directory('$base/pickforge-$pid');
  await dir.create(recursive: true);
  return '${dir.path}/agent.sock';
}

@module
abstract class AgentProfileModule {
  @singleton
  ClaudeCodeProfile get claudeCodeProfile => const ClaudeCodeProfile();

  @singleton
  CodexProfile get codexProfile => const CodexProfile();

  @singleton
  OpenCodeProfile get opencodeProfile => const OpenCodeProfile();

  @singleton
  AgentProfileRegistry agentProfileRegistry(
    ClaudeCodeProfile claude,
    CodexProfile codex,
    OpenCodeProfile opencode,
  ) =>
      AgentProfileRegistry([claude, codex, opencode]);
}

@module
abstract class SkillsModule {
  @singleton
  SkillStore get skillStore => SkillStore();
}

@module
abstract class AgentLauncherModule {
  @singleton
  WidgetContextRenderer get widgetContextRenderer =>
      const WidgetContextRenderer();

  @singleton
  AgentLauncher agentLauncher(
    AgentProfileRegistry agentRegistry,
    PickforgeContextWriter contextWriter,
    SkillStore skillStore,
    WidgetContextRenderer widgetRenderer,
  ) =>
      AgentLauncher(
        agentRegistry: agentRegistry,
        contextWriter: contextWriter,
        skillStore: skillStore,
        widgetRenderer: widgetRenderer,
      );
}

@module
abstract class BinaryDetectorModule {
  @singleton
  BinaryDetector get binaryDetector => BinaryDetector();
}

@module
abstract class AdbScreenshotModule {
  @singleton
  AdbScreenshotCapturer adbScreenshotCapturer(BinaryDetector detector) =>
      AdbScreenshotCapturer(detector);
}

@module
abstract class DriftDaoModule {
  @lazySingleton
  ProjectsDao projectsDao(PickforgeDatabase db) => ProjectsDao(db);

  @lazySingleton
  ChatsDao chatsDao(PickforgeDatabase db) => ChatsDao(db);

  @lazySingleton
  ProjectSettingsDao projectSettingsDao(PickforgeDatabase db) =>
      ProjectSettingsDao(db);

  @lazySingleton
  RunSessionLogDao runSessionLogDao(PickforgeDatabase db) =>
      RunSessionLogDao(db);
}
