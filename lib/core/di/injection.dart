import 'dart:io';

import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/headless/chat_prompt_dispatcher.dart';
import 'package:pickforge/core/agent/headless/claude_code_stream_json_adapter.dart';
import 'package:pickforge/core/agent/headless/codex_exec_json_adapter.dart';
import 'package:pickforge/core/agent/headless/headless_chat_adapter_registry.dart';
import 'package:pickforge/core/agent/headless/headless_chat_feature_flags.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session_pool.dart';
import 'package:pickforge/core/agent/headless/opencode_run_json_adapter.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/cursor_profile.dart';
import 'package:pickforge/core/agent/profiles/gemini_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/di/injection.config.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
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
import 'package:pickforge/core/telemetry/crash_report_service.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

final GetIt getIt = GetIt.instance;

@InjectableInit()
Future<void> configureDependencies() async {
  await getIt.init();
  if (!getIt.isRegistered<ProcessRunner>()) {
    getIt.registerSingleton<ProcessRunner>(RealProcessRunner());
  }
  if (!getIt.isRegistered<DiagnosticsService>()) {
    getIt.registerLazySingleton<DiagnosticsService>(
      () => DiagnosticsService(getIt<ProcessRunner>()),
    );
  }
  if (!getIt.isRegistered<UpdateCheckSettingsRepository>()) {
    getIt.registerLazySingleton<UpdateCheckSettingsRepository>(
      () => UpdateCheckSettingsRepository(getIt<SharedPreferences>()),
    );
  }
  if (!getIt.isRegistered<UpdateCheckService>()) {
    getIt.registerLazySingleton<UpdateCheckService>(
      () => UpdateCheckService(
        settings: getIt<UpdateCheckSettingsRepository>(),
      ),
    );
  }
  if (!getIt.isRegistered<TelemetrySettingsRepository>()) {
    getIt.registerLazySingleton<TelemetrySettingsRepository>(
      () => TelemetrySettingsRepository(getIt<SharedPreferences>()),
    );
  }
  if (!getIt.isRegistered<CrashReportService>()) {
    getIt.registerLazySingleton<CrashReportService>(
      () => CrashReportService(
        settings: getIt<TelemetrySettingsRepository>(),
      ),
    );
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
  final endpoint = defaultEmulatorIpcEndpoint();
  if (!Platform.isWindows) {
    await File(endpoint).parent.create(recursive: true);
  }
  return endpoint;
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
  CursorProfile get cursorProfile => const CursorProfile();

  @singleton
  GeminiProfile get geminiProfile => const GeminiProfile();

  @singleton
  AgentProfileRegistry agentProfileRegistry(
    ClaudeCodeProfile claude,
    CodexProfile codex,
    OpenCodeProfile opencode,
    CursorProfile cursor,
    GeminiProfile gemini,
  ) =>
      AgentProfileRegistry([claude, codex, opencode, cursor, gemini]);
}

@module
abstract class HeadlessChatModule {
  @singleton
  ClaudeCodeStreamJsonAdapter get claudeCodeStreamJsonAdapter =>
      const ClaudeCodeStreamJsonAdapter();

  @singleton
  CodexExecJsonAdapter get codexExecJsonAdapter => const CodexExecJsonAdapter();

  @singleton
  OpenCodeRunJsonAdapter get openCodeRunJsonAdapter =>
      const OpenCodeRunJsonAdapter();

  @singleton
  HeadlessChatAdapterRegistry headlessChatAdapterRegistry(
    ClaudeCodeStreamJsonAdapter claude,
    CodexExecJsonAdapter codex,
    OpenCodeRunJsonAdapter opencode,
  ) =>
      HeadlessChatAdapterRegistry([claude, codex, opencode]);

  @lazySingleton
  HeadlessChatFeatureFlags get headlessChatFeatureFlags =>
      const HeadlessChatFeatureFlags.fromEnvironment();

  @lazySingleton
  HeadlessChatSessionPool headlessChatSessionPool(
    ProcessRunner runner,
    HeadlessChatAdapterRegistry registry,
  ) =>
      HeadlessChatSessionPool(runner, registry);

  @lazySingleton
  ChatPromptDispatcher chatPromptDispatcher(
    PtySessionPool ptyPool,
    HeadlessChatSessionPool headlessPool,
    HeadlessChatFeatureFlags flags,
  ) =>
      ChatPromptDispatcher(ptyPool, headlessPool, flags);
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
