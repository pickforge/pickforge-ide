import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';
import 'package:pickforge/core/di/injection.config.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/terminal/profiles/alacritty_profile.dart';
import 'package:pickforge/core/terminal/profiles/env_fallback_profile.dart';
import 'package:pickforge/core/terminal/profiles/ghostty_profile.dart';
import 'package:pickforge/core/terminal/profiles/gnome_terminal_profile.dart';
import 'package:pickforge/core/terminal/profiles/iterm2_profile.dart';
import 'package:pickforge/core/terminal/profiles/kitty_profile.dart';
import 'package:pickforge/core/terminal/profiles/terminal_app_profile.dart';
import 'package:pickforge/core/terminal/profiles/warp_profile.dart';
import 'package:pickforge/core/terminal/profiles/wezterm_profile.dart';
import 'package:pickforge/core/terminal/profiles/windows_terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';

final GetIt getIt = GetIt.instance;

@InjectableInit()
Future<void> configureDependencies() async => getIt.init();

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
abstract class TerminalProfileModule {
  @singleton
  TerminalDetector get terminalDetector => TerminalDetector();

  @singleton
  List<TerminalProfile> terminalProfiles(TerminalDetector detector) => [
        GhosttyProfile(detector),
        WezTermProfile(detector),
        AlacrittyProfile(detector),
        KittyProfile(detector),
        GnomeTerminalProfile(detector),
        ITerm2Profile(detector),
        TerminalAppProfile(detector),
        EnvFallbackProfile(detector),
        WindowsTerminalProfile(detector),
        WarpProfile(detector),
      ];

  @singleton
  TerminalProfileRegistry terminalProfileRegistry(
    List<TerminalProfile> profiles,
  ) =>
      TerminalProfileRegistry(profiles);
}

@module
abstract class SkillsModule {
  @singleton
  SkillStore get skillStore => SkillStore();
}

@module
abstract class AgentLauncherModule {
  @singleton
  PickforgeDirManager get pickforgeDirManager => PickforgeDirManager();

  @singleton
  WidgetContextRenderer get widgetContextRenderer =>
      const WidgetContextRenderer();

  @singleton
  WrapperScriptGenerator get wrapperScriptGenerator =>
      const WrapperScriptGenerator();

  @singleton
  AgentLauncher agentLauncher(
    AgentProfileRegistry agentRegistry,
    TerminalProfileRegistry terminalRegistry,
    PickforgeDirManager dirManager,
    SkillStore skillStore,
    WidgetContextRenderer widgetRenderer,
    WrapperScriptGenerator scriptGenerator,
  ) =>
      AgentLauncher(
        agentRegistry: agentRegistry,
        terminalRegistry: terminalRegistry,
        dirManager: dirManager,
        skillStore: skillStore,
        widgetRenderer: widgetRenderer,
        scriptGenerator: scriptGenerator,
      );
}

@module
abstract class AdbScreenshotModule {
  @singleton
  AdbScreenshotCapturer adbScreenshotCapturer(TerminalDetector detector) =>
      AdbScreenshotCapturer(detector);
}

@module
abstract class DriftDaoModule {
  @lazySingleton
  ProjectsDao projectsDao(PickforgeDatabase db) => ProjectsDao(db);

  @lazySingleton
  ChatsDao chatsDao(PickforgeDatabase db) => ChatsDao(db);
}
