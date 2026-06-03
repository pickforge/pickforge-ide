import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';

@lazySingleton
class ProjectSettingsRepository {
  ProjectSettingsRepository(this._db);

  final PickforgeDatabase _db;

  Future<String?> getVmServiceUrl(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    return row?.vmServiceUrl;
  }

  Future<void> setVmServiceUrl(String projectRoot, String url) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      vmServiceUrl: url,
    );
  }

  Future<String?> getDefaultAgentId(String projectRoot) async =>
      (await _db.projectSettingsDao.loadFor(projectRoot))?.defaultAgentId;

  Future<void> setDefaultAgentId(String projectRoot, String agentId) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      defaultAgentId: agentId,
    );
  }

  Future<String?> getLastChatId(String projectRoot) =>
      _db.projectSettingsDao.lastChatId(projectRoot);

  Future<void> setLastChatId(String projectRoot, String? chatId) async {
    await _db.projectSettingsDao
        .upsert(projectRoot: projectRoot); // ensure row exists
    await _db.projectSettingsDao.setLastChatId(projectRoot, chatId);
  }

  Future<String?> getPaneSizes(String projectRoot) =>
      _db.projectSettingsDao.paneSizes(projectRoot);

  Future<void> setPaneSizes(String projectRoot, String? json) async {
    await _db.projectSettingsDao
        .upsert(projectRoot: projectRoot); // ensure row exists
    await _db.projectSettingsDao.setPaneSizes(projectRoot, json);
  }

  Future<EmulatorBinding?> getEmulatorBinding(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    if (row == null) return null;
    if (row.connectionMode == 'manual' && row.vmServiceUrl != null) {
      return EmulatorBinding.manual(vmServiceUrl: row.vmServiceUrl!);
    }
    if (row.connectionMode == 'physical' && row.avdId != null) {
      return EmulatorBinding.physical(
        serial: row.avdId!,
        name: row.avdName ?? row.avdId!,
      );
    }
    if (row.connectionMode == 'ios' && row.avdId != null) {
      return EmulatorBinding.iosSimulator(
        simulatorId: row.avdId!,
        name: row.avdName ?? row.avdId!,
      );
    }
    if (row.connectionMode == 'web' && row.avdId != null) {
      return EmulatorBinding.webTarget(
        targetId: row.avdId!,
        name: row.avdName ?? row.avdId!,
      );
    }
    if (row.avdId != null && row.avdName != null) {
      return EmulatorBinding.avd(
        avdId: row.avdId!,
        avdName: row.avdName!,
        autoBootOnSelect: row.autoBootOnSelect,
      );
    }
    return null;
  }

  Future<void> setEmulatorBinding(
    String projectRoot,
    EmulatorBinding binding,
  ) async {
    switch (binding) {
      case AvdBinding(:final avdId, :final avdName, :final autoBootOnSelect):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          avdId: Value(avdId),
          avdName: Value(avdName),
          connectionMode: const Value('auto'),
          autoBootOnSelect: autoBootOnSelect,
          vmServiceUrl: const Value<String?>(null),
        );
      case PhysicalDeviceBinding(:final serial, :final name):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          avdId: Value(serial),
          avdName: Value(name),
          connectionMode: const Value('physical'),
          autoBootOnSelect: false,
          vmServiceUrl: const Value<String?>(null),
        );
      case IosSimulatorBinding(:final simulatorId, :final name):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          avdId: Value(simulatorId),
          avdName: Value(name),
          connectionMode: const Value('ios'),
          autoBootOnSelect: false,
          vmServiceUrl: const Value<String?>(null),
        );
      case WebTargetBinding(:final targetId, :final name):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          avdId: Value(targetId),
          avdName: Value(name),
          connectionMode: const Value('web'),
          autoBootOnSelect: false,
          vmServiceUrl: const Value<String?>(null),
        );
      case ManualBinding(:final vmServiceUrl):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          vmServiceUrl: Value(vmServiceUrl),
          connectionMode: const Value('manual'),
          avdId: const Value<String?>(null),
          avdName: const Value<String?>(null),
        );
    }
  }

  Future<void> clearEmulatorBinding(String projectRoot) =>
      _db.projectSettingsDao.clearEmulatorBinding(projectRoot);

  Future<RunArgs> getRunArgs(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    if (row == null) return const RunArgs();
    final extras = row.flutterRunArgs;
    final list = extras == null
        ? const <String>[]
        : (jsonDecode(extras) as List<dynamic>).cast<String>();
    return RunArgs(targetFile: row.targetFile, extraArgs: list);
  }

  Future<void> setRunArgs(String projectRoot, RunArgs args) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      targetFile: Value(args.targetFile),
      flutterRunArgs: Value(jsonEncode(args.extraArgs)),
    );
  }

  Future<EmulatorLaunchOptions> getEmulatorLaunchOptions(
    String projectRoot,
  ) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    final json = row?.emulatorLaunchOptions;
    if (json == null) return const EmulatorLaunchOptions();
    return EmulatorLaunchOptions.fromJson(
      (jsonDecode(json) as Map<String, dynamic>).cast<String, Object?>(),
    );
  }

  Future<void> setEmulatorLaunchOptions(
    String projectRoot,
    EmulatorLaunchOptions options,
  ) {
    final errors = options.validationErrors;
    if (errors.isNotEmpty) {
      throw ArgumentError(errors.join('\n'));
    }
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      emulatorLaunchOptions: Value(
        options.isDefault ? null : jsonEncode(options.toJson()),
      ),
    );
  }

  Future<EmulatorIdleShutdownSettings> getEmulatorIdleShutdownSettings(
    String projectRoot,
  ) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    final json = row?.emulatorIdleShutdown;
    if (json == null) return const EmulatorIdleShutdownSettings();
    return EmulatorIdleShutdownSettings.fromJson(
      (jsonDecode(json) as Map<String, dynamic>).cast<String, Object?>(),
    );
  }

  Future<void> setEmulatorIdleShutdownSettings(
    String projectRoot,
    EmulatorIdleShutdownSettings settings,
  ) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      emulatorIdleShutdown: Value(
        settings.isDefault ? null : jsonEncode(settings.toJson()),
      ),
    );
  }

  Future<void> markFirstRunCelebrated(String projectRoot) =>
      _db.projectSettingsDao.markFirstRunCelebrated(projectRoot);
}
