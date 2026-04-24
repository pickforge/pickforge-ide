import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/di/injection.config.dart';

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
