import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/di/injection.config.dart';
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
