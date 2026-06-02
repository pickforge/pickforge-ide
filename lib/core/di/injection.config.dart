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
import 'package:pickforge/core/agent/agent_launcher.dart' as _i683;
import 'package:pickforge/core/agent/agent_profile_registry.dart' as _i360;
import 'package:pickforge/core/agent/pickforge_context_writer.dart' as _i342;
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart' as _i14;
import 'package:pickforge/core/agent/profiles/codex_profile.dart' as _i454;
import 'package:pickforge/core/agent/profiles/opencode_profile.dart' as _i621;
import 'package:pickforge/core/agent/widget_context_renderer.dart' as _i810;
import 'package:pickforge/core/chats/chats_repository.dart' as _i779;
import 'package:pickforge/core/di/app_bootstrap.dart' as _i536;
import 'package:pickforge/core/di/injection.dart' as _i74;
import 'package:pickforge/core/di/modules/terminal_runtime_module.dart'
    as _i398;
import 'package:pickforge/core/drift/dao/chats_dao.dart' as _i905;
import 'package:pickforge/core/drift/dao/project_settings_dao.dart' as _i459;
import 'package:pickforge/core/drift/dao/projects_dao.dart' as _i1070;
import 'package:pickforge/core/drift/dao/run_session_log_dao.dart' as _i693;
import 'package:pickforge/core/drift/pickforge_database.dart' as _i631;
import 'package:pickforge/core/emulator/avd_launcher.dart' as _i276;
import 'package:pickforge/core/emulator/boot_readiness_poller.dart' as _i210;
import 'package:pickforge/core/emulator/device_discovery_service.dart' as _i577;
import 'package:pickforge/core/emulator/process_runner.dart' as _i788;
import 'package:pickforge/core/emulator/run_session_controller.dart' as _i849;
import 'package:pickforge/core/emulator/run_session_log_repository.dart'
    as _i227;
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart' as _i704;
import 'package:pickforge/core/process/binary_detector.dart' as _i993;
import 'package:pickforge/core/projects/projects_repository.dart' as _i613;
import 'package:pickforge/core/settings/project_settings_repository.dart'
    as _i340;
import 'package:pickforge/core/skills/skill_store.dart' as _i895;
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart'
    as _i195;
import 'package:pickforge/core/terminal/flutter_pty_adapter.dart' as _i93;
import 'package:pickforge/core/terminal/pty_process.dart' as _i602;
import 'package:pickforge/core/terminal/pty_session_pool.dart' as _i685;
import 'package:pickforge/core/vm_service/vm_service_client.dart' as _i292;
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart'
    as _i132;
import 'package:pickforge/features/forge/cubit/forge_cubit.dart' as _i888;
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart'
    as _i998;
import 'package:pickforge/features/settings/cubit/settings_cubit.dart' as _i18;
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart' as _i154;
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart'
    as _i882;
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart'
    as _i638;
import 'package:shared_preferences/shared_preferences.dart' as _i460;

extension GetItInjectableX on _i174.GetIt {
// initializes the registration of main-scope dependencies inside of GetIt
  Future<_i174.GetIt> init({
    String? environment,
    _i526.EnvironmentFilter? environmentFilter,
  }) async {
    final gh = _i526.GetItHelper(
      this,
      environment,
      environmentFilter,
    );
    final terminalRuntimeModule = _$TerminalRuntimeModule();
    final agentProfileModule = _$AgentProfileModule();
    final skillsModule = _$SkillsModule();
    final agentLauncherModule = _$AgentLauncherModule();
    final binaryDetectorModule = _$BinaryDetectorModule();
    final driftDaoModule = _$DriftDaoModule();
    final adbScreenshotModule = _$AdbScreenshotModule();
    await gh.factoryAsync<_i460.SharedPreferences>(
      () => terminalRuntimeModule.prefs,
      preResolve: true,
    );
    gh.singleton<_i14.ClaudeCodeProfile>(
        () => agentProfileModule.claudeCodeProfile);
    gh.singleton<_i454.CodexProfile>(() => agentProfileModule.codexProfile);
    gh.singleton<_i621.OpenCodeProfile>(
        () => agentProfileModule.opencodeProfile);
    gh.singleton<_i895.SkillStore>(() => skillsModule.skillStore);
    gh.singleton<_i810.WidgetContextRenderer>(
        () => agentLauncherModule.widgetContextRenderer);
    gh.singleton<_i993.BinaryDetector>(
        () => binaryDetectorModule.binaryDetector);
    gh.lazySingleton<_i342.PickforgeContextWriter>(
        () => _i342.PickforgeContextWriter());
    gh.lazySingleton<_i536.AppBootstrap>(() => _i536.AppBootstrap());
    gh.lazySingleton<_i631.PickforgeDatabase>(() => _i631.PickforgeDatabase());
    gh.lazySingleton<_i685.PtySessionPool>(() => _i685.PtySessionPool());
    gh.lazySingleton<_i292.VmServiceClient>(() => _i292.VmServiceClient());
    gh.lazySingleton<_i1070.ProjectsDao>(
        () => driftDaoModule.projectsDao(gh<_i631.PickforgeDatabase>()));
    gh.lazySingleton<_i905.ChatsDao>(
        () => driftDaoModule.chatsDao(gh<_i631.PickforgeDatabase>()));
    gh.lazySingleton<_i459.ProjectSettingsDao>(
        () => driftDaoModule.projectSettingsDao(gh<_i631.PickforgeDatabase>()));
    gh.lazySingleton<_i693.RunSessionLogDao>(
        () => driftDaoModule.runSessionLogDao(gh<_i631.PickforgeDatabase>()));
    gh.lazySingleton<_i276.AvdLauncher>(
        () => _i276.AvdLauncher(gh<_i788.ProcessRunner>()));
    gh.lazySingleton<_i210.BootReadinessPoller>(
        () => _i210.BootReadinessPoller(gh<_i788.ProcessRunner>()));
    gh.lazySingleton<_i577.DeviceDiscoveryService>(
        () => _i577.DeviceDiscoveryService(gh<_i788.ProcessRunner>()));
    gh.lazySingleton<_i849.RunSessionController>(
        () => _i849.RunSessionController(gh<_i788.ProcessRunner>()));
    gh.singleton<_i360.AgentProfileRegistry>(
        () => agentProfileModule.agentProfileRegistry(
              gh<_i14.ClaudeCodeProfile>(),
              gh<_i454.CodexProfile>(),
              gh<_i621.OpenCodeProfile>(),
            ));
    gh.lazySingleton<_i779.ChatsRepository>(
        () => _i779.ChatsRepository(gh<_i905.ChatsDao>()));
    gh.factory<_i638.WorkbenchLayoutCubit>(
        () => _i638.WorkbenchLayoutCubit(gh<_i459.ProjectSettingsDao>()));
    gh.singleton<_i683.AgentLauncher>(() => agentLauncherModule.agentLauncher(
          gh<_i360.AgentProfileRegistry>(),
          gh<_i342.PickforgeContextWriter>(),
          gh<_i895.SkillStore>(),
          gh<_i810.WidgetContextRenderer>(),
        ));
    gh.lazySingleton<_i602.PtyProcessFactory>(() => _i93.FlutterPtyAdapter());
    gh.lazySingleton<_i195.EmbeddedTerminalSettingsRepository>(() =>
        _i195.EmbeddedTerminalSettingsRepository(
            gh<_i460.SharedPreferences>()));
    gh.lazySingleton<_i227.RunSessionLogRepository>(
        () => _i227.RunSessionLogRepository(gh<_i631.PickforgeDatabase>()));
    gh.lazySingleton<_i340.ProjectSettingsRepository>(
        () => _i340.ProjectSettingsRepository(gh<_i631.PickforgeDatabase>()));
    gh.singleton<_i704.AdbScreenshotCapturer>(() =>
        adbScreenshotModule.adbScreenshotCapturer(gh<_i993.BinaryDetector>()));
    gh.factory<_i888.ForgeCubit>(() => _i888.ForgeCubit(
          gh<_i683.AgentLauncher>(),
          gh<_i704.AdbScreenshotCapturer>(),
          gh<_i685.PtySessionPool>(),
        ));
    gh.factory<_i154.ChatsCubit>(() => _i154.ChatsCubit(
          gh<_i779.ChatsRepository>(),
          gh<_i340.ProjectSettingsRepository>(),
        ));
    gh.factory<_i132.DevicePickerCubit>(
        () => _i132.DevicePickerCubit(gh<_i577.DeviceDiscoveryService>()));
    gh.lazySingleton<_i613.ProjectsRepository>(
        () => _i613.ProjectsRepository(gh<_i1070.ProjectsDao>()));
    gh.factory<_i18.SettingsCubit>(() => _i18.SettingsCubit(
          gh<_i340.ProjectSettingsRepository>(),
          gh<_i195.EmbeddedTerminalSettingsRepository>(),
        ));
    gh.factory<_i998.DeviceRunSettingsCubit>(() => _i998.DeviceRunSettingsCubit(
          settings: gh<_i340.ProjectSettingsRepository>(),
          discovery: gh<_i577.DeviceDiscoveryService>(),
        ));
    gh.factory<_i882.ProjectsCubit>(() => _i882.ProjectsCubit(
          gh<_i613.ProjectsRepository>(),
          gh<_i685.PtySessionPool>(),
        ));
    return this;
  }
}

class _$TerminalRuntimeModule extends _i398.TerminalRuntimeModule {}

class _$AgentProfileModule extends _i74.AgentProfileModule {}

class _$SkillsModule extends _i74.SkillsModule {}

class _$AgentLauncherModule extends _i74.AgentLauncherModule {}

class _$BinaryDetectorModule extends _i74.BinaryDetectorModule {}

class _$DriftDaoModule extends _i74.DriftDaoModule {}

class _$AdbScreenshotModule extends _i74.AdbScreenshotModule {}
