import 'dart:io';

import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

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
import 'package:pickforge/core/appearance/appearance_settings.dart';
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
import 'package:pickforge/core/logging/app_logging.dart';
import 'package:pickforge/core/logging/log_file_writer.dart';
import 'package:pickforge/core/notifications/forge_chime.dart';
import 'package:pickforge/core/notifications/notification_settings.dart';
import 'package:pickforge/core/process/binary_detector.dart' hide ProcessRunner;
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/storage/context_storage_migrator.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/targets/flutter_target_adapter.dart';
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/react_native/react_native_target_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/telemetry/crash_report_service.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:pickforge/features/workbench/cubit/chat_attention_cubit.dart';
import 'package:shared_preferences/shared_preferences.dart';

final GetIt getIt = GetIt.instance;

@InjectableInit()
Future<void> configureDependencies() async {
  // Registered before getIt.init() so the generated graph can resolve it, yet
  // built lazily and WITHOUT pulling the Drift database (and its path_provider
  // lookup) at construction time — the database is only touched when resolve()
  // actually runs, by which point the app is fully initialised.
  if (!getIt.isRegistered<ContextStorageService>()) {
    getIt.registerLazySingleton<ContextStorageService>(
      () => ContextStorageService(
        settingsProvider: getIt.get<ProjectSettingsRepository>,
      ),
    );
  }
  await getIt.init();
  if (!getIt.isRegistered<ProcessRunner>()) {
    getIt.registerSingleton<ProcessRunner>(RealProcessRunner());
  }
  if (!getIt.isRegistered<DiagnosticsService>()) {
    getIt.registerLazySingleton<DiagnosticsService>(
      () => DiagnosticsService(getIt<ProcessRunner>()),
    );
  }
  if (!getIt.isRegistered<AppLogging>()) {
    try {
      final supportDir = await getApplicationSupportDirectory();
      getIt.registerSingleton<AppLogging>(
        AppLogging(
          writer: LogFileWriter(
            directory: Directory(p.join(supportDir.path, 'logs')),
          ),
          diagnostics: getIt<DiagnosticsService>(),
        ),
        dispose: (logging) => logging.dispose(),
      );
    } on Object {
      // No path_provider implementation (tests, headless harnesses): the
      // app runs without a file log. Logging must never block startup.
    }
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
  if (!getIt.isRegistered<NotificationSettingsRepository>()) {
    getIt.registerLazySingleton<NotificationSettingsRepository>(
      () => NotificationSettingsRepository(getIt<SharedPreferences>()),
    );
  }
  if (!getIt.isRegistered<ForgeChime>()) {
    getIt.registerLazySingleton<ForgeChime>(
      () => ForgeChime(runner: getIt<ProcessRunner>()),
    );
  }
  if (!getIt.isRegistered<ChatAttentionCubit>()) {
    getIt.registerLazySingleton<ChatAttentionCubit>(
      () => ChatAttentionCubit(
        chime: getIt<ForgeChime>(),
        settings: getIt<NotificationSettingsRepository>(),
      ),
      dispose: (cubit) => cubit.close(),
    );
  }
  if (!getIt.isRegistered<AppearanceSettingsRepository>()) {
    getIt.registerLazySingleton<AppearanceSettingsRepository>(
      () => AppearanceSettingsRepository(getIt<SharedPreferences>()),
    );
  }
  if (!getIt.isRegistered<AppearanceController>()) {
    getIt.registerLazySingleton<AppearanceController>(
      () => AppearanceController(getIt<AppearanceSettingsRepository>())..init(),
      dispose: (controller) => controller.dispose(),
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
  SkillStore skillStore(ContextStorageService storage) => SkillStore(storage);
}

@module
abstract class StorageModule {
  @lazySingleton
  ContextStorageMigrator get contextStorageMigrator =>
      const ContextStorageMigrator();
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
    ContextStorageService storage,
  ) =>
      AgentLauncher(
        agentRegistry: agentRegistry,
        contextWriter: contextWriter,
        skillStore: skillStore,
        widgetRenderer: widgetRenderer,
        storage: storage,
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

@module
abstract class TargetsModule {
  // Flutter (deep support, priority 100), React Native Android (useful
  // support, 80), and the generic fallback (0). Order doesn't matter — the
  // registry sorts by descending priority.
  @lazySingleton
  TargetAdapterRegistry targetAdapterRegistry() => TargetAdapterRegistry(
        const [
          FlutterTargetAdapter(),
          ReactNativeTargetAdapter(),
          GenericProjectAdapter(),
        ],
      );
}
