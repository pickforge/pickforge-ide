// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format width=80

// **************************************************************************
// InjectableConfigGenerator
// **************************************************************************

// ignore_for_file: type=lint
// coverage:ignore-file

// ignore_for_file: no_leading_underscores_for_library_prefixes
import 'package:get_it/get_it.dart' as _i174;
import 'package:injectable/injectable.dart' as _i526;
import 'package:pickforge/core/agent/agent_profile_registry.dart' as _i360;
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart' as _i14;
import 'package:pickforge/core/agent/profiles/codex_profile.dart' as _i454;
import 'package:pickforge/core/agent/profiles/opencode_profile.dart' as _i621;
import 'package:pickforge/core/di/app_bootstrap.dart' as _i536;
import 'package:pickforge/core/di/injection.dart' as _i74;
import 'package:pickforge/core/drift/pickforge_database.dart' as _i631;
import 'package:pickforge/core/settings/project_settings_repository.dart'
    as _i340;
import 'package:pickforge/core/terminal/terminal_detector.dart' as _i77;
import 'package:pickforge/core/terminal/terminal_profile.dart' as _i681;
import 'package:pickforge/core/terminal/terminal_profile_registry.dart'
    as _i871;
import 'package:pickforge/core/vm_service/vm_service_client.dart' as _i292;

extension GetItInjectableX on _i174.GetIt {
// initializes the registration of main-scope dependencies inside of GetIt
  _i174.GetIt init({
    String? environment,
    _i526.EnvironmentFilter? environmentFilter,
  }) {
    final gh = _i526.GetItHelper(
      this,
      environment,
      environmentFilter,
    );
    final agentProfileModule = _$AgentProfileModule();
    final terminalProfileModule = _$TerminalProfileModule();
    gh.singleton<_i14.ClaudeCodeProfile>(
        () => agentProfileModule.claudeCodeProfile);
    gh.singleton<_i454.CodexProfile>(() => agentProfileModule.codexProfile);
    gh.singleton<_i621.OpenCodeProfile>(
        () => agentProfileModule.opencodeProfile);
    gh.singleton<_i77.TerminalDetector>(
        () => terminalProfileModule.terminalDetector);
    gh.lazySingleton<_i536.AppBootstrap>(() => _i536.AppBootstrap());
    gh.lazySingleton<_i631.PickforgeDatabase>(() => _i631.PickforgeDatabase());
    gh.lazySingleton<_i292.VmServiceClient>(() => _i292.VmServiceClient());
    gh.singleton<_i360.AgentProfileRegistry>(
        () => agentProfileModule.agentProfileRegistry(
              gh<_i14.ClaudeCodeProfile>(),
              gh<_i454.CodexProfile>(),
              gh<_i621.OpenCodeProfile>(),
            ));
    gh.lazySingleton<_i340.ProjectSettingsRepository>(
        () => _i340.ProjectSettingsRepository(gh<_i631.PickforgeDatabase>()));
    gh.singleton<List<_i681.TerminalProfile>>(() =>
        terminalProfileModule.terminalProfiles(gh<_i77.TerminalDetector>()));
    gh.singleton<_i871.TerminalProfileRegistry>(() => terminalProfileModule
        .terminalProfileRegistry(gh<List<_i681.TerminalProfile>>()));
    return this;
  }
}

class _$AgentProfileModule extends _i74.AgentProfileModule {}

class _$TerminalProfileModule extends _i74.TerminalProfileModule {}
