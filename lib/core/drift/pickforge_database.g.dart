// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pickforge_database.dart';

// ignore_for_file: type=lint
class $ProjectSettingsTable extends ProjectSettings
    with TableInfo<$ProjectSettingsTable, ProjectSettingsRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ProjectSettingsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _projectRootMeta =
      const VerificationMeta('projectRoot');
  @override
  late final GeneratedColumn<String> projectRoot = GeneratedColumn<String>(
      'project_root', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _vmServiceUrlMeta =
      const VerificationMeta('vmServiceUrl');
  @override
  late final GeneratedColumn<String> vmServiceUrl = GeneratedColumn<String>(
      'vm_service_url', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _defaultAgentIdMeta =
      const VerificationMeta('defaultAgentId');
  @override
  late final GeneratedColumn<String> defaultAgentId = GeneratedColumn<String>(
      'default_agent_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _lastChatIdMeta =
      const VerificationMeta('lastChatId');
  @override
  late final GeneratedColumn<String> lastChatId = GeneratedColumn<String>(
      'last_chat_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _paneSizesMeta =
      const VerificationMeta('paneSizes');
  @override
  late final GeneratedColumn<String> paneSizes = GeneratedColumn<String>(
      'pane_sizes', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _lastUsedAtMeta =
      const VerificationMeta('lastUsedAt');
  @override
  late final GeneratedColumn<DateTime> lastUsedAt = GeneratedColumn<DateTime>(
      'last_used_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _avdIdMeta = const VerificationMeta('avdId');
  @override
  late final GeneratedColumn<String> avdId = GeneratedColumn<String>(
      'avd_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _avdNameMeta =
      const VerificationMeta('avdName');
  @override
  late final GeneratedColumn<String> avdName = GeneratedColumn<String>(
      'avd_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _connectionModeMeta =
      const VerificationMeta('connectionMode');
  @override
  late final GeneratedColumn<String> connectionMode = GeneratedColumn<String>(
      'connection_mode', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: false,
      defaultValue: const Constant('auto'));
  static const VerificationMeta _flutterRunArgsMeta =
      const VerificationMeta('flutterRunArgs');
  @override
  late final GeneratedColumn<String> flutterRunArgs = GeneratedColumn<String>(
      'flutter_run_args', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _targetFileMeta =
      const VerificationMeta('targetFile');
  @override
  late final GeneratedColumn<String> targetFile = GeneratedColumn<String>(
      'target_file', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _autoBootOnSelectMeta =
      const VerificationMeta('autoBootOnSelect');
  @override
  late final GeneratedColumn<bool> autoBootOnSelect = GeneratedColumn<bool>(
      'auto_boot_on_select', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("auto_boot_on_select" IN (0, 1))'),
      defaultValue: const Constant(true));
  static const VerificationMeta _firstRunCelebratedMeta =
      const VerificationMeta('firstRunCelebrated');
  @override
  late final GeneratedColumn<bool> firstRunCelebrated = GeneratedColumn<bool>(
      'first_run_celebrated', aliasedName, false,
      type: DriftSqlType.bool,
      requiredDuringInsert: false,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'CHECK ("first_run_celebrated" IN (0, 1))'),
      defaultValue: const Constant(false));
  @override
  List<GeneratedColumn> get $columns => [
        projectRoot,
        vmServiceUrl,
        defaultAgentId,
        lastChatId,
        paneSizes,
        lastUsedAt,
        avdId,
        avdName,
        connectionMode,
        flutterRunArgs,
        targetFile,
        autoBootOnSelect,
        firstRunCelebrated
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'project_settings';
  @override
  VerificationContext validateIntegrity(Insertable<ProjectSettingsRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('project_root')) {
      context.handle(
          _projectRootMeta,
          projectRoot.isAcceptableOrUnknown(
              data['project_root']!, _projectRootMeta));
    } else if (isInserting) {
      context.missing(_projectRootMeta);
    }
    if (data.containsKey('vm_service_url')) {
      context.handle(
          _vmServiceUrlMeta,
          vmServiceUrl.isAcceptableOrUnknown(
              data['vm_service_url']!, _vmServiceUrlMeta));
    }
    if (data.containsKey('default_agent_id')) {
      context.handle(
          _defaultAgentIdMeta,
          defaultAgentId.isAcceptableOrUnknown(
              data['default_agent_id']!, _defaultAgentIdMeta));
    }
    if (data.containsKey('last_chat_id')) {
      context.handle(
          _lastChatIdMeta,
          lastChatId.isAcceptableOrUnknown(
              data['last_chat_id']!, _lastChatIdMeta));
    }
    if (data.containsKey('pane_sizes')) {
      context.handle(_paneSizesMeta,
          paneSizes.isAcceptableOrUnknown(data['pane_sizes']!, _paneSizesMeta));
    }
    if (data.containsKey('last_used_at')) {
      context.handle(
          _lastUsedAtMeta,
          lastUsedAt.isAcceptableOrUnknown(
              data['last_used_at']!, _lastUsedAtMeta));
    }
    if (data.containsKey('avd_id')) {
      context.handle(
          _avdIdMeta, avdId.isAcceptableOrUnknown(data['avd_id']!, _avdIdMeta));
    }
    if (data.containsKey('avd_name')) {
      context.handle(_avdNameMeta,
          avdName.isAcceptableOrUnknown(data['avd_name']!, _avdNameMeta));
    }
    if (data.containsKey('connection_mode')) {
      context.handle(
          _connectionModeMeta,
          connectionMode.isAcceptableOrUnknown(
              data['connection_mode']!, _connectionModeMeta));
    }
    if (data.containsKey('flutter_run_args')) {
      context.handle(
          _flutterRunArgsMeta,
          flutterRunArgs.isAcceptableOrUnknown(
              data['flutter_run_args']!, _flutterRunArgsMeta));
    }
    if (data.containsKey('target_file')) {
      context.handle(
          _targetFileMeta,
          targetFile.isAcceptableOrUnknown(
              data['target_file']!, _targetFileMeta));
    }
    if (data.containsKey('auto_boot_on_select')) {
      context.handle(
          _autoBootOnSelectMeta,
          autoBootOnSelect.isAcceptableOrUnknown(
              data['auto_boot_on_select']!, _autoBootOnSelectMeta));
    }
    if (data.containsKey('first_run_celebrated')) {
      context.handle(
          _firstRunCelebratedMeta,
          firstRunCelebrated.isAcceptableOrUnknown(
              data['first_run_celebrated']!, _firstRunCelebratedMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {projectRoot};
  @override
  ProjectSettingsRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ProjectSettingsRow(
      projectRoot: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}project_root'])!,
      vmServiceUrl: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}vm_service_url']),
      defaultAgentId: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}default_agent_id']),
      lastChatId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_chat_id']),
      paneSizes: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}pane_sizes']),
      lastUsedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}last_used_at']),
      avdId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}avd_id']),
      avdName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}avd_name']),
      connectionMode: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}connection_mode'])!,
      flutterRunArgs: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}flutter_run_args']),
      targetFile: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}target_file']),
      autoBootOnSelect: attachedDatabase.typeMapping.read(
          DriftSqlType.bool, data['${effectivePrefix}auto_boot_on_select'])!,
      firstRunCelebrated: attachedDatabase.typeMapping.read(
          DriftSqlType.bool, data['${effectivePrefix}first_run_celebrated'])!,
    );
  }

  @override
  $ProjectSettingsTable createAlias(String alias) {
    return $ProjectSettingsTable(attachedDatabase, alias);
  }
}

class ProjectSettingsRow extends DataClass
    implements Insertable<ProjectSettingsRow> {
  final String projectRoot;
  final String? vmServiceUrl;
  final String? defaultAgentId;
  final String? lastChatId;
  final String? paneSizes;
  final DateTime? lastUsedAt;
  final String? avdId;
  final String? avdName;
  final String connectionMode;
  final String? flutterRunArgs;
  final String? targetFile;
  final bool autoBootOnSelect;
  final bool firstRunCelebrated;
  const ProjectSettingsRow(
      {required this.projectRoot,
      this.vmServiceUrl,
      this.defaultAgentId,
      this.lastChatId,
      this.paneSizes,
      this.lastUsedAt,
      this.avdId,
      this.avdName,
      required this.connectionMode,
      this.flutterRunArgs,
      this.targetFile,
      required this.autoBootOnSelect,
      required this.firstRunCelebrated});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['project_root'] = Variable<String>(projectRoot);
    if (!nullToAbsent || vmServiceUrl != null) {
      map['vm_service_url'] = Variable<String>(vmServiceUrl);
    }
    if (!nullToAbsent || defaultAgentId != null) {
      map['default_agent_id'] = Variable<String>(defaultAgentId);
    }
    if (!nullToAbsent || lastChatId != null) {
      map['last_chat_id'] = Variable<String>(lastChatId);
    }
    if (!nullToAbsent || paneSizes != null) {
      map['pane_sizes'] = Variable<String>(paneSizes);
    }
    if (!nullToAbsent || lastUsedAt != null) {
      map['last_used_at'] = Variable<DateTime>(lastUsedAt);
    }
    if (!nullToAbsent || avdId != null) {
      map['avd_id'] = Variable<String>(avdId);
    }
    if (!nullToAbsent || avdName != null) {
      map['avd_name'] = Variable<String>(avdName);
    }
    map['connection_mode'] = Variable<String>(connectionMode);
    if (!nullToAbsent || flutterRunArgs != null) {
      map['flutter_run_args'] = Variable<String>(flutterRunArgs);
    }
    if (!nullToAbsent || targetFile != null) {
      map['target_file'] = Variable<String>(targetFile);
    }
    map['auto_boot_on_select'] = Variable<bool>(autoBootOnSelect);
    map['first_run_celebrated'] = Variable<bool>(firstRunCelebrated);
    return map;
  }

  ProjectSettingsCompanion toCompanion(bool nullToAbsent) {
    return ProjectSettingsCompanion(
      projectRoot: Value(projectRoot),
      vmServiceUrl: vmServiceUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(vmServiceUrl),
      defaultAgentId: defaultAgentId == null && nullToAbsent
          ? const Value.absent()
          : Value(defaultAgentId),
      lastChatId: lastChatId == null && nullToAbsent
          ? const Value.absent()
          : Value(lastChatId),
      paneSizes: paneSizes == null && nullToAbsent
          ? const Value.absent()
          : Value(paneSizes),
      lastUsedAt: lastUsedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastUsedAt),
      avdId:
          avdId == null && nullToAbsent ? const Value.absent() : Value(avdId),
      avdName: avdName == null && nullToAbsent
          ? const Value.absent()
          : Value(avdName),
      connectionMode: Value(connectionMode),
      flutterRunArgs: flutterRunArgs == null && nullToAbsent
          ? const Value.absent()
          : Value(flutterRunArgs),
      targetFile: targetFile == null && nullToAbsent
          ? const Value.absent()
          : Value(targetFile),
      autoBootOnSelect: Value(autoBootOnSelect),
      firstRunCelebrated: Value(firstRunCelebrated),
    );
  }

  factory ProjectSettingsRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ProjectSettingsRow(
      projectRoot: serializer.fromJson<String>(json['projectRoot']),
      vmServiceUrl: serializer.fromJson<String?>(json['vmServiceUrl']),
      defaultAgentId: serializer.fromJson<String?>(json['defaultAgentId']),
      lastChatId: serializer.fromJson<String?>(json['lastChatId']),
      paneSizes: serializer.fromJson<String?>(json['paneSizes']),
      lastUsedAt: serializer.fromJson<DateTime?>(json['lastUsedAt']),
      avdId: serializer.fromJson<String?>(json['avdId']),
      avdName: serializer.fromJson<String?>(json['avdName']),
      connectionMode: serializer.fromJson<String>(json['connectionMode']),
      flutterRunArgs: serializer.fromJson<String?>(json['flutterRunArgs']),
      targetFile: serializer.fromJson<String?>(json['targetFile']),
      autoBootOnSelect: serializer.fromJson<bool>(json['autoBootOnSelect']),
      firstRunCelebrated: serializer.fromJson<bool>(json['firstRunCelebrated']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'projectRoot': serializer.toJson<String>(projectRoot),
      'vmServiceUrl': serializer.toJson<String?>(vmServiceUrl),
      'defaultAgentId': serializer.toJson<String?>(defaultAgentId),
      'lastChatId': serializer.toJson<String?>(lastChatId),
      'paneSizes': serializer.toJson<String?>(paneSizes),
      'lastUsedAt': serializer.toJson<DateTime?>(lastUsedAt),
      'avdId': serializer.toJson<String?>(avdId),
      'avdName': serializer.toJson<String?>(avdName),
      'connectionMode': serializer.toJson<String>(connectionMode),
      'flutterRunArgs': serializer.toJson<String?>(flutterRunArgs),
      'targetFile': serializer.toJson<String?>(targetFile),
      'autoBootOnSelect': serializer.toJson<bool>(autoBootOnSelect),
      'firstRunCelebrated': serializer.toJson<bool>(firstRunCelebrated),
    };
  }

  ProjectSettingsRow copyWith(
          {String? projectRoot,
          Value<String?> vmServiceUrl = const Value.absent(),
          Value<String?> defaultAgentId = const Value.absent(),
          Value<String?> lastChatId = const Value.absent(),
          Value<String?> paneSizes = const Value.absent(),
          Value<DateTime?> lastUsedAt = const Value.absent(),
          Value<String?> avdId = const Value.absent(),
          Value<String?> avdName = const Value.absent(),
          String? connectionMode,
          Value<String?> flutterRunArgs = const Value.absent(),
          Value<String?> targetFile = const Value.absent(),
          bool? autoBootOnSelect,
          bool? firstRunCelebrated}) =>
      ProjectSettingsRow(
        projectRoot: projectRoot ?? this.projectRoot,
        vmServiceUrl:
            vmServiceUrl.present ? vmServiceUrl.value : this.vmServiceUrl,
        defaultAgentId:
            defaultAgentId.present ? defaultAgentId.value : this.defaultAgentId,
        lastChatId: lastChatId.present ? lastChatId.value : this.lastChatId,
        paneSizes: paneSizes.present ? paneSizes.value : this.paneSizes,
        lastUsedAt: lastUsedAt.present ? lastUsedAt.value : this.lastUsedAt,
        avdId: avdId.present ? avdId.value : this.avdId,
        avdName: avdName.present ? avdName.value : this.avdName,
        connectionMode: connectionMode ?? this.connectionMode,
        flutterRunArgs:
            flutterRunArgs.present ? flutterRunArgs.value : this.flutterRunArgs,
        targetFile: targetFile.present ? targetFile.value : this.targetFile,
        autoBootOnSelect: autoBootOnSelect ?? this.autoBootOnSelect,
        firstRunCelebrated: firstRunCelebrated ?? this.firstRunCelebrated,
      );
  ProjectSettingsRow copyWithCompanion(ProjectSettingsCompanion data) {
    return ProjectSettingsRow(
      projectRoot:
          data.projectRoot.present ? data.projectRoot.value : this.projectRoot,
      vmServiceUrl: data.vmServiceUrl.present
          ? data.vmServiceUrl.value
          : this.vmServiceUrl,
      defaultAgentId: data.defaultAgentId.present
          ? data.defaultAgentId.value
          : this.defaultAgentId,
      lastChatId:
          data.lastChatId.present ? data.lastChatId.value : this.lastChatId,
      paneSizes: data.paneSizes.present ? data.paneSizes.value : this.paneSizes,
      lastUsedAt:
          data.lastUsedAt.present ? data.lastUsedAt.value : this.lastUsedAt,
      avdId: data.avdId.present ? data.avdId.value : this.avdId,
      avdName: data.avdName.present ? data.avdName.value : this.avdName,
      connectionMode: data.connectionMode.present
          ? data.connectionMode.value
          : this.connectionMode,
      flutterRunArgs: data.flutterRunArgs.present
          ? data.flutterRunArgs.value
          : this.flutterRunArgs,
      targetFile:
          data.targetFile.present ? data.targetFile.value : this.targetFile,
      autoBootOnSelect: data.autoBootOnSelect.present
          ? data.autoBootOnSelect.value
          : this.autoBootOnSelect,
      firstRunCelebrated: data.firstRunCelebrated.present
          ? data.firstRunCelebrated.value
          : this.firstRunCelebrated,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ProjectSettingsRow(')
          ..write('projectRoot: $projectRoot, ')
          ..write('vmServiceUrl: $vmServiceUrl, ')
          ..write('defaultAgentId: $defaultAgentId, ')
          ..write('lastChatId: $lastChatId, ')
          ..write('paneSizes: $paneSizes, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('avdId: $avdId, ')
          ..write('avdName: $avdName, ')
          ..write('connectionMode: $connectionMode, ')
          ..write('flutterRunArgs: $flutterRunArgs, ')
          ..write('targetFile: $targetFile, ')
          ..write('autoBootOnSelect: $autoBootOnSelect, ')
          ..write('firstRunCelebrated: $firstRunCelebrated')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      projectRoot,
      vmServiceUrl,
      defaultAgentId,
      lastChatId,
      paneSizes,
      lastUsedAt,
      avdId,
      avdName,
      connectionMode,
      flutterRunArgs,
      targetFile,
      autoBootOnSelect,
      firstRunCelebrated);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ProjectSettingsRow &&
          other.projectRoot == this.projectRoot &&
          other.vmServiceUrl == this.vmServiceUrl &&
          other.defaultAgentId == this.defaultAgentId &&
          other.lastChatId == this.lastChatId &&
          other.paneSizes == this.paneSizes &&
          other.lastUsedAt == this.lastUsedAt &&
          other.avdId == this.avdId &&
          other.avdName == this.avdName &&
          other.connectionMode == this.connectionMode &&
          other.flutterRunArgs == this.flutterRunArgs &&
          other.targetFile == this.targetFile &&
          other.autoBootOnSelect == this.autoBootOnSelect &&
          other.firstRunCelebrated == this.firstRunCelebrated);
}

class ProjectSettingsCompanion extends UpdateCompanion<ProjectSettingsRow> {
  final Value<String> projectRoot;
  final Value<String?> vmServiceUrl;
  final Value<String?> defaultAgentId;
  final Value<String?> lastChatId;
  final Value<String?> paneSizes;
  final Value<DateTime?> lastUsedAt;
  final Value<String?> avdId;
  final Value<String?> avdName;
  final Value<String> connectionMode;
  final Value<String?> flutterRunArgs;
  final Value<String?> targetFile;
  final Value<bool> autoBootOnSelect;
  final Value<bool> firstRunCelebrated;
  final Value<int> rowid;
  const ProjectSettingsCompanion({
    this.projectRoot = const Value.absent(),
    this.vmServiceUrl = const Value.absent(),
    this.defaultAgentId = const Value.absent(),
    this.lastChatId = const Value.absent(),
    this.paneSizes = const Value.absent(),
    this.lastUsedAt = const Value.absent(),
    this.avdId = const Value.absent(),
    this.avdName = const Value.absent(),
    this.connectionMode = const Value.absent(),
    this.flutterRunArgs = const Value.absent(),
    this.targetFile = const Value.absent(),
    this.autoBootOnSelect = const Value.absent(),
    this.firstRunCelebrated = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ProjectSettingsCompanion.insert({
    required String projectRoot,
    this.vmServiceUrl = const Value.absent(),
    this.defaultAgentId = const Value.absent(),
    this.lastChatId = const Value.absent(),
    this.paneSizes = const Value.absent(),
    this.lastUsedAt = const Value.absent(),
    this.avdId = const Value.absent(),
    this.avdName = const Value.absent(),
    this.connectionMode = const Value.absent(),
    this.flutterRunArgs = const Value.absent(),
    this.targetFile = const Value.absent(),
    this.autoBootOnSelect = const Value.absent(),
    this.firstRunCelebrated = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : projectRoot = Value(projectRoot);
  static Insertable<ProjectSettingsRow> custom({
    Expression<String>? projectRoot,
    Expression<String>? vmServiceUrl,
    Expression<String>? defaultAgentId,
    Expression<String>? lastChatId,
    Expression<String>? paneSizes,
    Expression<DateTime>? lastUsedAt,
    Expression<String>? avdId,
    Expression<String>? avdName,
    Expression<String>? connectionMode,
    Expression<String>? flutterRunArgs,
    Expression<String>? targetFile,
    Expression<bool>? autoBootOnSelect,
    Expression<bool>? firstRunCelebrated,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (projectRoot != null) 'project_root': projectRoot,
      if (vmServiceUrl != null) 'vm_service_url': vmServiceUrl,
      if (defaultAgentId != null) 'default_agent_id': defaultAgentId,
      if (lastChatId != null) 'last_chat_id': lastChatId,
      if (paneSizes != null) 'pane_sizes': paneSizes,
      if (lastUsedAt != null) 'last_used_at': lastUsedAt,
      if (avdId != null) 'avd_id': avdId,
      if (avdName != null) 'avd_name': avdName,
      if (connectionMode != null) 'connection_mode': connectionMode,
      if (flutterRunArgs != null) 'flutter_run_args': flutterRunArgs,
      if (targetFile != null) 'target_file': targetFile,
      if (autoBootOnSelect != null) 'auto_boot_on_select': autoBootOnSelect,
      if (firstRunCelebrated != null)
        'first_run_celebrated': firstRunCelebrated,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ProjectSettingsCompanion copyWith(
      {Value<String>? projectRoot,
      Value<String?>? vmServiceUrl,
      Value<String?>? defaultAgentId,
      Value<String?>? lastChatId,
      Value<String?>? paneSizes,
      Value<DateTime?>? lastUsedAt,
      Value<String?>? avdId,
      Value<String?>? avdName,
      Value<String>? connectionMode,
      Value<String?>? flutterRunArgs,
      Value<String?>? targetFile,
      Value<bool>? autoBootOnSelect,
      Value<bool>? firstRunCelebrated,
      Value<int>? rowid}) {
    return ProjectSettingsCompanion(
      projectRoot: projectRoot ?? this.projectRoot,
      vmServiceUrl: vmServiceUrl ?? this.vmServiceUrl,
      defaultAgentId: defaultAgentId ?? this.defaultAgentId,
      lastChatId: lastChatId ?? this.lastChatId,
      paneSizes: paneSizes ?? this.paneSizes,
      lastUsedAt: lastUsedAt ?? this.lastUsedAt,
      avdId: avdId ?? this.avdId,
      avdName: avdName ?? this.avdName,
      connectionMode: connectionMode ?? this.connectionMode,
      flutterRunArgs: flutterRunArgs ?? this.flutterRunArgs,
      targetFile: targetFile ?? this.targetFile,
      autoBootOnSelect: autoBootOnSelect ?? this.autoBootOnSelect,
      firstRunCelebrated: firstRunCelebrated ?? this.firstRunCelebrated,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (projectRoot.present) {
      map['project_root'] = Variable<String>(projectRoot.value);
    }
    if (vmServiceUrl.present) {
      map['vm_service_url'] = Variable<String>(vmServiceUrl.value);
    }
    if (defaultAgentId.present) {
      map['default_agent_id'] = Variable<String>(defaultAgentId.value);
    }
    if (lastChatId.present) {
      map['last_chat_id'] = Variable<String>(lastChatId.value);
    }
    if (paneSizes.present) {
      map['pane_sizes'] = Variable<String>(paneSizes.value);
    }
    if (lastUsedAt.present) {
      map['last_used_at'] = Variable<DateTime>(lastUsedAt.value);
    }
    if (avdId.present) {
      map['avd_id'] = Variable<String>(avdId.value);
    }
    if (avdName.present) {
      map['avd_name'] = Variable<String>(avdName.value);
    }
    if (connectionMode.present) {
      map['connection_mode'] = Variable<String>(connectionMode.value);
    }
    if (flutterRunArgs.present) {
      map['flutter_run_args'] = Variable<String>(flutterRunArgs.value);
    }
    if (targetFile.present) {
      map['target_file'] = Variable<String>(targetFile.value);
    }
    if (autoBootOnSelect.present) {
      map['auto_boot_on_select'] = Variable<bool>(autoBootOnSelect.value);
    }
    if (firstRunCelebrated.present) {
      map['first_run_celebrated'] = Variable<bool>(firstRunCelebrated.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ProjectSettingsCompanion(')
          ..write('projectRoot: $projectRoot, ')
          ..write('vmServiceUrl: $vmServiceUrl, ')
          ..write('defaultAgentId: $defaultAgentId, ')
          ..write('lastChatId: $lastChatId, ')
          ..write('paneSizes: $paneSizes, ')
          ..write('lastUsedAt: $lastUsedAt, ')
          ..write('avdId: $avdId, ')
          ..write('avdName: $avdName, ')
          ..write('connectionMode: $connectionMode, ')
          ..write('flutterRunArgs: $flutterRunArgs, ')
          ..write('targetFile: $targetFile, ')
          ..write('autoBootOnSelect: $autoBootOnSelect, ')
          ..write('firstRunCelebrated: $firstRunCelebrated, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $PickHistoryTable extends PickHistory
    with TableInfo<$PickHistoryTable, PickHistoryRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PickHistoryTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _projectRootMeta =
      const VerificationMeta('projectRoot');
  @override
  late final GeneratedColumn<String> projectRoot = GeneratedColumn<String>(
      'project_root', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _widgetClassMeta =
      const VerificationMeta('widgetClass');
  @override
  late final GeneratedColumn<String> widgetClass = GeneratedColumn<String>(
      'widget_class', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _creationFileMeta =
      const VerificationMeta('creationFile');
  @override
  late final GeneratedColumn<String> creationFile = GeneratedColumn<String>(
      'creation_file', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _creationLineMeta =
      const VerificationMeta('creationLine');
  @override
  late final GeneratedColumn<int> creationLine = GeneratedColumn<int>(
      'creation_line', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _skillIdMeta =
      const VerificationMeta('skillId');
  @override
  late final GeneratedColumn<String> skillId = GeneratedColumn<String>(
      'skill_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _agentIdMeta =
      const VerificationMeta('agentId');
  @override
  late final GeneratedColumn<String> agentId = GeneratedColumn<String>(
      'agent_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _terminalIdMeta =
      const VerificationMeta('terminalId');
  @override
  late final GeneratedColumn<String> terminalId = GeneratedColumn<String>(
      'terminal_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _chatIdMeta = const VerificationMeta('chatId');
  @override
  late final GeneratedColumn<String> chatId = GeneratedColumn<String>(
      'chat_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _pickedAtMeta =
      const VerificationMeta('pickedAt');
  @override
  late final GeneratedColumn<DateTime> pickedAt = GeneratedColumn<DateTime>(
      'picked_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _widgetContextJsonMeta =
      const VerificationMeta('widgetContextJson');
  @override
  late final GeneratedColumn<String> widgetContextJson =
      GeneratedColumn<String>('widget_context_json', aliasedName, false,
          type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        projectRoot,
        widgetClass,
        creationFile,
        creationLine,
        skillId,
        agentId,
        terminalId,
        chatId,
        pickedAt,
        widgetContextJson
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pick_history';
  @override
  VerificationContext validateIntegrity(Insertable<PickHistoryRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('project_root')) {
      context.handle(
          _projectRootMeta,
          projectRoot.isAcceptableOrUnknown(
              data['project_root']!, _projectRootMeta));
    } else if (isInserting) {
      context.missing(_projectRootMeta);
    }
    if (data.containsKey('widget_class')) {
      context.handle(
          _widgetClassMeta,
          widgetClass.isAcceptableOrUnknown(
              data['widget_class']!, _widgetClassMeta));
    } else if (isInserting) {
      context.missing(_widgetClassMeta);
    }
    if (data.containsKey('creation_file')) {
      context.handle(
          _creationFileMeta,
          creationFile.isAcceptableOrUnknown(
              data['creation_file']!, _creationFileMeta));
    }
    if (data.containsKey('creation_line')) {
      context.handle(
          _creationLineMeta,
          creationLine.isAcceptableOrUnknown(
              data['creation_line']!, _creationLineMeta));
    }
    if (data.containsKey('skill_id')) {
      context.handle(_skillIdMeta,
          skillId.isAcceptableOrUnknown(data['skill_id']!, _skillIdMeta));
    } else if (isInserting) {
      context.missing(_skillIdMeta);
    }
    if (data.containsKey('agent_id')) {
      context.handle(_agentIdMeta,
          agentId.isAcceptableOrUnknown(data['agent_id']!, _agentIdMeta));
    } else if (isInserting) {
      context.missing(_agentIdMeta);
    }
    if (data.containsKey('terminal_id')) {
      context.handle(
          _terminalIdMeta,
          terminalId.isAcceptableOrUnknown(
              data['terminal_id']!, _terminalIdMeta));
    } else if (isInserting) {
      context.missing(_terminalIdMeta);
    }
    if (data.containsKey('chat_id')) {
      context.handle(_chatIdMeta,
          chatId.isAcceptableOrUnknown(data['chat_id']!, _chatIdMeta));
    }
    if (data.containsKey('picked_at')) {
      context.handle(_pickedAtMeta,
          pickedAt.isAcceptableOrUnknown(data['picked_at']!, _pickedAtMeta));
    } else if (isInserting) {
      context.missing(_pickedAtMeta);
    }
    if (data.containsKey('widget_context_json')) {
      context.handle(
          _widgetContextJsonMeta,
          widgetContextJson.isAcceptableOrUnknown(
              data['widget_context_json']!, _widgetContextJsonMeta));
    } else if (isInserting) {
      context.missing(_widgetContextJsonMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PickHistoryRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PickHistoryRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      projectRoot: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}project_root'])!,
      widgetClass: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}widget_class'])!,
      creationFile: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}creation_file']),
      creationLine: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}creation_line']),
      skillId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}skill_id'])!,
      agentId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}agent_id'])!,
      terminalId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}terminal_id'])!,
      chatId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}chat_id']),
      pickedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}picked_at'])!,
      widgetContextJson: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}widget_context_json'])!,
    );
  }

  @override
  $PickHistoryTable createAlias(String alias) {
    return $PickHistoryTable(attachedDatabase, alias);
  }
}

class PickHistoryRow extends DataClass implements Insertable<PickHistoryRow> {
  final int id;
  final String projectRoot;
  final String widgetClass;
  final String? creationFile;
  final int? creationLine;
  final String skillId;
  final String agentId;
  final String terminalId;
  final String? chatId;
  final DateTime pickedAt;
  final String widgetContextJson;
  const PickHistoryRow(
      {required this.id,
      required this.projectRoot,
      required this.widgetClass,
      this.creationFile,
      this.creationLine,
      required this.skillId,
      required this.agentId,
      required this.terminalId,
      this.chatId,
      required this.pickedAt,
      required this.widgetContextJson});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['project_root'] = Variable<String>(projectRoot);
    map['widget_class'] = Variable<String>(widgetClass);
    if (!nullToAbsent || creationFile != null) {
      map['creation_file'] = Variable<String>(creationFile);
    }
    if (!nullToAbsent || creationLine != null) {
      map['creation_line'] = Variable<int>(creationLine);
    }
    map['skill_id'] = Variable<String>(skillId);
    map['agent_id'] = Variable<String>(agentId);
    map['terminal_id'] = Variable<String>(terminalId);
    if (!nullToAbsent || chatId != null) {
      map['chat_id'] = Variable<String>(chatId);
    }
    map['picked_at'] = Variable<DateTime>(pickedAt);
    map['widget_context_json'] = Variable<String>(widgetContextJson);
    return map;
  }

  PickHistoryCompanion toCompanion(bool nullToAbsent) {
    return PickHistoryCompanion(
      id: Value(id),
      projectRoot: Value(projectRoot),
      widgetClass: Value(widgetClass),
      creationFile: creationFile == null && nullToAbsent
          ? const Value.absent()
          : Value(creationFile),
      creationLine: creationLine == null && nullToAbsent
          ? const Value.absent()
          : Value(creationLine),
      skillId: Value(skillId),
      agentId: Value(agentId),
      terminalId: Value(terminalId),
      chatId:
          chatId == null && nullToAbsent ? const Value.absent() : Value(chatId),
      pickedAt: Value(pickedAt),
      widgetContextJson: Value(widgetContextJson),
    );
  }

  factory PickHistoryRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PickHistoryRow(
      id: serializer.fromJson<int>(json['id']),
      projectRoot: serializer.fromJson<String>(json['projectRoot']),
      widgetClass: serializer.fromJson<String>(json['widgetClass']),
      creationFile: serializer.fromJson<String?>(json['creationFile']),
      creationLine: serializer.fromJson<int?>(json['creationLine']),
      skillId: serializer.fromJson<String>(json['skillId']),
      agentId: serializer.fromJson<String>(json['agentId']),
      terminalId: serializer.fromJson<String>(json['terminalId']),
      chatId: serializer.fromJson<String?>(json['chatId']),
      pickedAt: serializer.fromJson<DateTime>(json['pickedAt']),
      widgetContextJson: serializer.fromJson<String>(json['widgetContextJson']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'projectRoot': serializer.toJson<String>(projectRoot),
      'widgetClass': serializer.toJson<String>(widgetClass),
      'creationFile': serializer.toJson<String?>(creationFile),
      'creationLine': serializer.toJson<int?>(creationLine),
      'skillId': serializer.toJson<String>(skillId),
      'agentId': serializer.toJson<String>(agentId),
      'terminalId': serializer.toJson<String>(terminalId),
      'chatId': serializer.toJson<String?>(chatId),
      'pickedAt': serializer.toJson<DateTime>(pickedAt),
      'widgetContextJson': serializer.toJson<String>(widgetContextJson),
    };
  }

  PickHistoryRow copyWith(
          {int? id,
          String? projectRoot,
          String? widgetClass,
          Value<String?> creationFile = const Value.absent(),
          Value<int?> creationLine = const Value.absent(),
          String? skillId,
          String? agentId,
          String? terminalId,
          Value<String?> chatId = const Value.absent(),
          DateTime? pickedAt,
          String? widgetContextJson}) =>
      PickHistoryRow(
        id: id ?? this.id,
        projectRoot: projectRoot ?? this.projectRoot,
        widgetClass: widgetClass ?? this.widgetClass,
        creationFile:
            creationFile.present ? creationFile.value : this.creationFile,
        creationLine:
            creationLine.present ? creationLine.value : this.creationLine,
        skillId: skillId ?? this.skillId,
        agentId: agentId ?? this.agentId,
        terminalId: terminalId ?? this.terminalId,
        chatId: chatId.present ? chatId.value : this.chatId,
        pickedAt: pickedAt ?? this.pickedAt,
        widgetContextJson: widgetContextJson ?? this.widgetContextJson,
      );
  PickHistoryRow copyWithCompanion(PickHistoryCompanion data) {
    return PickHistoryRow(
      id: data.id.present ? data.id.value : this.id,
      projectRoot:
          data.projectRoot.present ? data.projectRoot.value : this.projectRoot,
      widgetClass:
          data.widgetClass.present ? data.widgetClass.value : this.widgetClass,
      creationFile: data.creationFile.present
          ? data.creationFile.value
          : this.creationFile,
      creationLine: data.creationLine.present
          ? data.creationLine.value
          : this.creationLine,
      skillId: data.skillId.present ? data.skillId.value : this.skillId,
      agentId: data.agentId.present ? data.agentId.value : this.agentId,
      terminalId:
          data.terminalId.present ? data.terminalId.value : this.terminalId,
      chatId: data.chatId.present ? data.chatId.value : this.chatId,
      pickedAt: data.pickedAt.present ? data.pickedAt.value : this.pickedAt,
      widgetContextJson: data.widgetContextJson.present
          ? data.widgetContextJson.value
          : this.widgetContextJson,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PickHistoryRow(')
          ..write('id: $id, ')
          ..write('projectRoot: $projectRoot, ')
          ..write('widgetClass: $widgetClass, ')
          ..write('creationFile: $creationFile, ')
          ..write('creationLine: $creationLine, ')
          ..write('skillId: $skillId, ')
          ..write('agentId: $agentId, ')
          ..write('terminalId: $terminalId, ')
          ..write('chatId: $chatId, ')
          ..write('pickedAt: $pickedAt, ')
          ..write('widgetContextJson: $widgetContextJson')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      id,
      projectRoot,
      widgetClass,
      creationFile,
      creationLine,
      skillId,
      agentId,
      terminalId,
      chatId,
      pickedAt,
      widgetContextJson);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PickHistoryRow &&
          other.id == this.id &&
          other.projectRoot == this.projectRoot &&
          other.widgetClass == this.widgetClass &&
          other.creationFile == this.creationFile &&
          other.creationLine == this.creationLine &&
          other.skillId == this.skillId &&
          other.agentId == this.agentId &&
          other.terminalId == this.terminalId &&
          other.chatId == this.chatId &&
          other.pickedAt == this.pickedAt &&
          other.widgetContextJson == this.widgetContextJson);
}

class PickHistoryCompanion extends UpdateCompanion<PickHistoryRow> {
  final Value<int> id;
  final Value<String> projectRoot;
  final Value<String> widgetClass;
  final Value<String?> creationFile;
  final Value<int?> creationLine;
  final Value<String> skillId;
  final Value<String> agentId;
  final Value<String> terminalId;
  final Value<String?> chatId;
  final Value<DateTime> pickedAt;
  final Value<String> widgetContextJson;
  const PickHistoryCompanion({
    this.id = const Value.absent(),
    this.projectRoot = const Value.absent(),
    this.widgetClass = const Value.absent(),
    this.creationFile = const Value.absent(),
    this.creationLine = const Value.absent(),
    this.skillId = const Value.absent(),
    this.agentId = const Value.absent(),
    this.terminalId = const Value.absent(),
    this.chatId = const Value.absent(),
    this.pickedAt = const Value.absent(),
    this.widgetContextJson = const Value.absent(),
  });
  PickHistoryCompanion.insert({
    this.id = const Value.absent(),
    required String projectRoot,
    required String widgetClass,
    this.creationFile = const Value.absent(),
    this.creationLine = const Value.absent(),
    required String skillId,
    required String agentId,
    required String terminalId,
    this.chatId = const Value.absent(),
    required DateTime pickedAt,
    required String widgetContextJson,
  })  : projectRoot = Value(projectRoot),
        widgetClass = Value(widgetClass),
        skillId = Value(skillId),
        agentId = Value(agentId),
        terminalId = Value(terminalId),
        pickedAt = Value(pickedAt),
        widgetContextJson = Value(widgetContextJson);
  static Insertable<PickHistoryRow> custom({
    Expression<int>? id,
    Expression<String>? projectRoot,
    Expression<String>? widgetClass,
    Expression<String>? creationFile,
    Expression<int>? creationLine,
    Expression<String>? skillId,
    Expression<String>? agentId,
    Expression<String>? terminalId,
    Expression<String>? chatId,
    Expression<DateTime>? pickedAt,
    Expression<String>? widgetContextJson,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (projectRoot != null) 'project_root': projectRoot,
      if (widgetClass != null) 'widget_class': widgetClass,
      if (creationFile != null) 'creation_file': creationFile,
      if (creationLine != null) 'creation_line': creationLine,
      if (skillId != null) 'skill_id': skillId,
      if (agentId != null) 'agent_id': agentId,
      if (terminalId != null) 'terminal_id': terminalId,
      if (chatId != null) 'chat_id': chatId,
      if (pickedAt != null) 'picked_at': pickedAt,
      if (widgetContextJson != null) 'widget_context_json': widgetContextJson,
    });
  }

  PickHistoryCompanion copyWith(
      {Value<int>? id,
      Value<String>? projectRoot,
      Value<String>? widgetClass,
      Value<String?>? creationFile,
      Value<int?>? creationLine,
      Value<String>? skillId,
      Value<String>? agentId,
      Value<String>? terminalId,
      Value<String?>? chatId,
      Value<DateTime>? pickedAt,
      Value<String>? widgetContextJson}) {
    return PickHistoryCompanion(
      id: id ?? this.id,
      projectRoot: projectRoot ?? this.projectRoot,
      widgetClass: widgetClass ?? this.widgetClass,
      creationFile: creationFile ?? this.creationFile,
      creationLine: creationLine ?? this.creationLine,
      skillId: skillId ?? this.skillId,
      agentId: agentId ?? this.agentId,
      terminalId: terminalId ?? this.terminalId,
      chatId: chatId ?? this.chatId,
      pickedAt: pickedAt ?? this.pickedAt,
      widgetContextJson: widgetContextJson ?? this.widgetContextJson,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (projectRoot.present) {
      map['project_root'] = Variable<String>(projectRoot.value);
    }
    if (widgetClass.present) {
      map['widget_class'] = Variable<String>(widgetClass.value);
    }
    if (creationFile.present) {
      map['creation_file'] = Variable<String>(creationFile.value);
    }
    if (creationLine.present) {
      map['creation_line'] = Variable<int>(creationLine.value);
    }
    if (skillId.present) {
      map['skill_id'] = Variable<String>(skillId.value);
    }
    if (agentId.present) {
      map['agent_id'] = Variable<String>(agentId.value);
    }
    if (terminalId.present) {
      map['terminal_id'] = Variable<String>(terminalId.value);
    }
    if (chatId.present) {
      map['chat_id'] = Variable<String>(chatId.value);
    }
    if (pickedAt.present) {
      map['picked_at'] = Variable<DateTime>(pickedAt.value);
    }
    if (widgetContextJson.present) {
      map['widget_context_json'] = Variable<String>(widgetContextJson.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PickHistoryCompanion(')
          ..write('id: $id, ')
          ..write('projectRoot: $projectRoot, ')
          ..write('widgetClass: $widgetClass, ')
          ..write('creationFile: $creationFile, ')
          ..write('creationLine: $creationLine, ')
          ..write('skillId: $skillId, ')
          ..write('agentId: $agentId, ')
          ..write('terminalId: $terminalId, ')
          ..write('chatId: $chatId, ')
          ..write('pickedAt: $pickedAt, ')
          ..write('widgetContextJson: $widgetContextJson')
          ..write(')'))
        .toString();
  }
}

class $AgentRunLogTable extends AgentRunLog
    with TableInfo<$AgentRunLogTable, AgentRunLogRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $AgentRunLogTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
      'id', aliasedName, false,
      hasAutoIncrement: true,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultConstraints:
          GeneratedColumn.constraintIsAlways('PRIMARY KEY AUTOINCREMENT'));
  static const VerificationMeta _pickIdMeta = const VerificationMeta('pickId');
  @override
  late final GeneratedColumn<int> pickId = GeneratedColumn<int>(
      'pick_id', aliasedName, false,
      type: DriftSqlType.int, requiredDuringInsert: true);
  static const VerificationMeta _startedAtMeta =
      const VerificationMeta('startedAt');
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
      'started_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _finishedAtMeta =
      const VerificationMeta('finishedAt');
  @override
  late final GeneratedColumn<DateTime> finishedAt = GeneratedColumn<DateTime>(
      'finished_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _exitCodeMeta =
      const VerificationMeta('exitCode');
  @override
  late final GeneratedColumn<int> exitCode = GeneratedColumn<int>(
      'exit_code', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _hotReloadCountMeta =
      const VerificationMeta('hotReloadCount');
  @override
  late final GeneratedColumn<int> hotReloadCount = GeneratedColumn<int>(
      'hot_reload_count', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _wrapperScriptPathMeta =
      const VerificationMeta('wrapperScriptPath');
  @override
  late final GeneratedColumn<String> wrapperScriptPath =
      GeneratedColumn<String>('wrapper_script_path', aliasedName, false,
          type: DriftSqlType.string, requiredDuringInsert: true);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        pickId,
        startedAt,
        finishedAt,
        exitCode,
        hotReloadCount,
        wrapperScriptPath
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'agent_run_log';
  @override
  VerificationContext validateIntegrity(Insertable<AgentRunLogRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('pick_id')) {
      context.handle(_pickIdMeta,
          pickId.isAcceptableOrUnknown(data['pick_id']!, _pickIdMeta));
    } else if (isInserting) {
      context.missing(_pickIdMeta);
    }
    if (data.containsKey('started_at')) {
      context.handle(_startedAtMeta,
          startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta));
    } else if (isInserting) {
      context.missing(_startedAtMeta);
    }
    if (data.containsKey('finished_at')) {
      context.handle(
          _finishedAtMeta,
          finishedAt.isAcceptableOrUnknown(
              data['finished_at']!, _finishedAtMeta));
    }
    if (data.containsKey('exit_code')) {
      context.handle(_exitCodeMeta,
          exitCode.isAcceptableOrUnknown(data['exit_code']!, _exitCodeMeta));
    }
    if (data.containsKey('hot_reload_count')) {
      context.handle(
          _hotReloadCountMeta,
          hotReloadCount.isAcceptableOrUnknown(
              data['hot_reload_count']!, _hotReloadCountMeta));
    }
    if (data.containsKey('wrapper_script_path')) {
      context.handle(
          _wrapperScriptPathMeta,
          wrapperScriptPath.isAcceptableOrUnknown(
              data['wrapper_script_path']!, _wrapperScriptPathMeta));
    } else if (isInserting) {
      context.missing(_wrapperScriptPathMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  AgentRunLogRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return AgentRunLogRow(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}id'])!,
      pickId: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}pick_id'])!,
      startedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}started_at'])!,
      finishedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}finished_at']),
      exitCode: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}exit_code']),
      hotReloadCount: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}hot_reload_count'])!,
      wrapperScriptPath: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}wrapper_script_path'])!,
    );
  }

  @override
  $AgentRunLogTable createAlias(String alias) {
    return $AgentRunLogTable(attachedDatabase, alias);
  }
}

class AgentRunLogRow extends DataClass implements Insertable<AgentRunLogRow> {
  final int id;
  final int pickId;
  final DateTime startedAt;
  final DateTime? finishedAt;
  final int? exitCode;
  final int hotReloadCount;
  final String wrapperScriptPath;
  const AgentRunLogRow(
      {required this.id,
      required this.pickId,
      required this.startedAt,
      this.finishedAt,
      this.exitCode,
      required this.hotReloadCount,
      required this.wrapperScriptPath});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['pick_id'] = Variable<int>(pickId);
    map['started_at'] = Variable<DateTime>(startedAt);
    if (!nullToAbsent || finishedAt != null) {
      map['finished_at'] = Variable<DateTime>(finishedAt);
    }
    if (!nullToAbsent || exitCode != null) {
      map['exit_code'] = Variable<int>(exitCode);
    }
    map['hot_reload_count'] = Variable<int>(hotReloadCount);
    map['wrapper_script_path'] = Variable<String>(wrapperScriptPath);
    return map;
  }

  AgentRunLogCompanion toCompanion(bool nullToAbsent) {
    return AgentRunLogCompanion(
      id: Value(id),
      pickId: Value(pickId),
      startedAt: Value(startedAt),
      finishedAt: finishedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(finishedAt),
      exitCode: exitCode == null && nullToAbsent
          ? const Value.absent()
          : Value(exitCode),
      hotReloadCount: Value(hotReloadCount),
      wrapperScriptPath: Value(wrapperScriptPath),
    );
  }

  factory AgentRunLogRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return AgentRunLogRow(
      id: serializer.fromJson<int>(json['id']),
      pickId: serializer.fromJson<int>(json['pickId']),
      startedAt: serializer.fromJson<DateTime>(json['startedAt']),
      finishedAt: serializer.fromJson<DateTime?>(json['finishedAt']),
      exitCode: serializer.fromJson<int?>(json['exitCode']),
      hotReloadCount: serializer.fromJson<int>(json['hotReloadCount']),
      wrapperScriptPath: serializer.fromJson<String>(json['wrapperScriptPath']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'pickId': serializer.toJson<int>(pickId),
      'startedAt': serializer.toJson<DateTime>(startedAt),
      'finishedAt': serializer.toJson<DateTime?>(finishedAt),
      'exitCode': serializer.toJson<int?>(exitCode),
      'hotReloadCount': serializer.toJson<int>(hotReloadCount),
      'wrapperScriptPath': serializer.toJson<String>(wrapperScriptPath),
    };
  }

  AgentRunLogRow copyWith(
          {int? id,
          int? pickId,
          DateTime? startedAt,
          Value<DateTime?> finishedAt = const Value.absent(),
          Value<int?> exitCode = const Value.absent(),
          int? hotReloadCount,
          String? wrapperScriptPath}) =>
      AgentRunLogRow(
        id: id ?? this.id,
        pickId: pickId ?? this.pickId,
        startedAt: startedAt ?? this.startedAt,
        finishedAt: finishedAt.present ? finishedAt.value : this.finishedAt,
        exitCode: exitCode.present ? exitCode.value : this.exitCode,
        hotReloadCount: hotReloadCount ?? this.hotReloadCount,
        wrapperScriptPath: wrapperScriptPath ?? this.wrapperScriptPath,
      );
  AgentRunLogRow copyWithCompanion(AgentRunLogCompanion data) {
    return AgentRunLogRow(
      id: data.id.present ? data.id.value : this.id,
      pickId: data.pickId.present ? data.pickId.value : this.pickId,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      finishedAt:
          data.finishedAt.present ? data.finishedAt.value : this.finishedAt,
      exitCode: data.exitCode.present ? data.exitCode.value : this.exitCode,
      hotReloadCount: data.hotReloadCount.present
          ? data.hotReloadCount.value
          : this.hotReloadCount,
      wrapperScriptPath: data.wrapperScriptPath.present
          ? data.wrapperScriptPath.value
          : this.wrapperScriptPath,
    );
  }

  @override
  String toString() {
    return (StringBuffer('AgentRunLogRow(')
          ..write('id: $id, ')
          ..write('pickId: $pickId, ')
          ..write('startedAt: $startedAt, ')
          ..write('finishedAt: $finishedAt, ')
          ..write('exitCode: $exitCode, ')
          ..write('hotReloadCount: $hotReloadCount, ')
          ..write('wrapperScriptPath: $wrapperScriptPath')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, pickId, startedAt, finishedAt, exitCode,
      hotReloadCount, wrapperScriptPath);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AgentRunLogRow &&
          other.id == this.id &&
          other.pickId == this.pickId &&
          other.startedAt == this.startedAt &&
          other.finishedAt == this.finishedAt &&
          other.exitCode == this.exitCode &&
          other.hotReloadCount == this.hotReloadCount &&
          other.wrapperScriptPath == this.wrapperScriptPath);
}

class AgentRunLogCompanion extends UpdateCompanion<AgentRunLogRow> {
  final Value<int> id;
  final Value<int> pickId;
  final Value<DateTime> startedAt;
  final Value<DateTime?> finishedAt;
  final Value<int?> exitCode;
  final Value<int> hotReloadCount;
  final Value<String> wrapperScriptPath;
  const AgentRunLogCompanion({
    this.id = const Value.absent(),
    this.pickId = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.finishedAt = const Value.absent(),
    this.exitCode = const Value.absent(),
    this.hotReloadCount = const Value.absent(),
    this.wrapperScriptPath = const Value.absent(),
  });
  AgentRunLogCompanion.insert({
    this.id = const Value.absent(),
    required int pickId,
    required DateTime startedAt,
    this.finishedAt = const Value.absent(),
    this.exitCode = const Value.absent(),
    this.hotReloadCount = const Value.absent(),
    required String wrapperScriptPath,
  })  : pickId = Value(pickId),
        startedAt = Value(startedAt),
        wrapperScriptPath = Value(wrapperScriptPath);
  static Insertable<AgentRunLogRow> custom({
    Expression<int>? id,
    Expression<int>? pickId,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? finishedAt,
    Expression<int>? exitCode,
    Expression<int>? hotReloadCount,
    Expression<String>? wrapperScriptPath,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (pickId != null) 'pick_id': pickId,
      if (startedAt != null) 'started_at': startedAt,
      if (finishedAt != null) 'finished_at': finishedAt,
      if (exitCode != null) 'exit_code': exitCode,
      if (hotReloadCount != null) 'hot_reload_count': hotReloadCount,
      if (wrapperScriptPath != null) 'wrapper_script_path': wrapperScriptPath,
    });
  }

  AgentRunLogCompanion copyWith(
      {Value<int>? id,
      Value<int>? pickId,
      Value<DateTime>? startedAt,
      Value<DateTime?>? finishedAt,
      Value<int?>? exitCode,
      Value<int>? hotReloadCount,
      Value<String>? wrapperScriptPath}) {
    return AgentRunLogCompanion(
      id: id ?? this.id,
      pickId: pickId ?? this.pickId,
      startedAt: startedAt ?? this.startedAt,
      finishedAt: finishedAt ?? this.finishedAt,
      exitCode: exitCode ?? this.exitCode,
      hotReloadCount: hotReloadCount ?? this.hotReloadCount,
      wrapperScriptPath: wrapperScriptPath ?? this.wrapperScriptPath,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (pickId.present) {
      map['pick_id'] = Variable<int>(pickId.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (finishedAt.present) {
      map['finished_at'] = Variable<DateTime>(finishedAt.value);
    }
    if (exitCode.present) {
      map['exit_code'] = Variable<int>(exitCode.value);
    }
    if (hotReloadCount.present) {
      map['hot_reload_count'] = Variable<int>(hotReloadCount.value);
    }
    if (wrapperScriptPath.present) {
      map['wrapper_script_path'] = Variable<String>(wrapperScriptPath.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('AgentRunLogCompanion(')
          ..write('id: $id, ')
          ..write('pickId: $pickId, ')
          ..write('startedAt: $startedAt, ')
          ..write('finishedAt: $finishedAt, ')
          ..write('exitCode: $exitCode, ')
          ..write('hotReloadCount: $hotReloadCount, ')
          ..write('wrapperScriptPath: $wrapperScriptPath')
          ..write(')'))
        .toString();
  }
}

class $ProjectsTable extends Projects
    with TableInfo<$ProjectsTable, ProjectRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ProjectsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _projectRootMeta =
      const VerificationMeta('projectRoot');
  @override
  late final GeneratedColumn<String> projectRoot = GeneratedColumn<String>(
      'project_root', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _displayNameMeta =
      const VerificationMeta('displayName');
  @override
  late final GeneratedColumn<String> displayName = GeneratedColumn<String>(
      'display_name', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _lastOpenedAtMeta =
      const VerificationMeta('lastOpenedAt');
  @override
  late final GeneratedColumn<DateTime> lastOpenedAt = GeneratedColumn<DateTime>(
      'last_opened_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _sortOrderMeta =
      const VerificationMeta('sortOrder');
  @override
  late final GeneratedColumn<int> sortOrder = GeneratedColumn<int>(
      'sort_order', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  @override
  List<GeneratedColumn> get $columns =>
      [projectRoot, displayName, createdAt, lastOpenedAt, sortOrder];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'projects';
  @override
  VerificationContext validateIntegrity(Insertable<ProjectRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('project_root')) {
      context.handle(
          _projectRootMeta,
          projectRoot.isAcceptableOrUnknown(
              data['project_root']!, _projectRootMeta));
    } else if (isInserting) {
      context.missing(_projectRootMeta);
    }
    if (data.containsKey('display_name')) {
      context.handle(
          _displayNameMeta,
          displayName.isAcceptableOrUnknown(
              data['display_name']!, _displayNameMeta));
    } else if (isInserting) {
      context.missing(_displayNameMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('last_opened_at')) {
      context.handle(
          _lastOpenedAtMeta,
          lastOpenedAt.isAcceptableOrUnknown(
              data['last_opened_at']!, _lastOpenedAtMeta));
    } else if (isInserting) {
      context.missing(_lastOpenedAtMeta);
    }
    if (data.containsKey('sort_order')) {
      context.handle(_sortOrderMeta,
          sortOrder.isAcceptableOrUnknown(data['sort_order']!, _sortOrderMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {projectRoot};
  @override
  ProjectRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ProjectRow(
      projectRoot: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}project_root'])!,
      displayName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}display_name'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      lastOpenedAt: attachedDatabase.typeMapping.read(
          DriftSqlType.dateTime, data['${effectivePrefix}last_opened_at'])!,
      sortOrder: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}sort_order'])!,
    );
  }

  @override
  $ProjectsTable createAlias(String alias) {
    return $ProjectsTable(attachedDatabase, alias);
  }
}

class ProjectRow extends DataClass implements Insertable<ProjectRow> {
  final String projectRoot;
  final String displayName;
  final DateTime createdAt;
  final DateTime lastOpenedAt;
  final int sortOrder;
  const ProjectRow(
      {required this.projectRoot,
      required this.displayName,
      required this.createdAt,
      required this.lastOpenedAt,
      required this.sortOrder});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['project_root'] = Variable<String>(projectRoot);
    map['display_name'] = Variable<String>(displayName);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['last_opened_at'] = Variable<DateTime>(lastOpenedAt);
    map['sort_order'] = Variable<int>(sortOrder);
    return map;
  }

  ProjectsCompanion toCompanion(bool nullToAbsent) {
    return ProjectsCompanion(
      projectRoot: Value(projectRoot),
      displayName: Value(displayName),
      createdAt: Value(createdAt),
      lastOpenedAt: Value(lastOpenedAt),
      sortOrder: Value(sortOrder),
    );
  }

  factory ProjectRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ProjectRow(
      projectRoot: serializer.fromJson<String>(json['projectRoot']),
      displayName: serializer.fromJson<String>(json['displayName']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      lastOpenedAt: serializer.fromJson<DateTime>(json['lastOpenedAt']),
      sortOrder: serializer.fromJson<int>(json['sortOrder']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'projectRoot': serializer.toJson<String>(projectRoot),
      'displayName': serializer.toJson<String>(displayName),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'lastOpenedAt': serializer.toJson<DateTime>(lastOpenedAt),
      'sortOrder': serializer.toJson<int>(sortOrder),
    };
  }

  ProjectRow copyWith(
          {String? projectRoot,
          String? displayName,
          DateTime? createdAt,
          DateTime? lastOpenedAt,
          int? sortOrder}) =>
      ProjectRow(
        projectRoot: projectRoot ?? this.projectRoot,
        displayName: displayName ?? this.displayName,
        createdAt: createdAt ?? this.createdAt,
        lastOpenedAt: lastOpenedAt ?? this.lastOpenedAt,
        sortOrder: sortOrder ?? this.sortOrder,
      );
  ProjectRow copyWithCompanion(ProjectsCompanion data) {
    return ProjectRow(
      projectRoot:
          data.projectRoot.present ? data.projectRoot.value : this.projectRoot,
      displayName:
          data.displayName.present ? data.displayName.value : this.displayName,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      lastOpenedAt: data.lastOpenedAt.present
          ? data.lastOpenedAt.value
          : this.lastOpenedAt,
      sortOrder: data.sortOrder.present ? data.sortOrder.value : this.sortOrder,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ProjectRow(')
          ..write('projectRoot: $projectRoot, ')
          ..write('displayName: $displayName, ')
          ..write('createdAt: $createdAt, ')
          ..write('lastOpenedAt: $lastOpenedAt, ')
          ..write('sortOrder: $sortOrder')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(projectRoot, displayName, createdAt, lastOpenedAt, sortOrder);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ProjectRow &&
          other.projectRoot == this.projectRoot &&
          other.displayName == this.displayName &&
          other.createdAt == this.createdAt &&
          other.lastOpenedAt == this.lastOpenedAt &&
          other.sortOrder == this.sortOrder);
}

class ProjectsCompanion extends UpdateCompanion<ProjectRow> {
  final Value<String> projectRoot;
  final Value<String> displayName;
  final Value<DateTime> createdAt;
  final Value<DateTime> lastOpenedAt;
  final Value<int> sortOrder;
  final Value<int> rowid;
  const ProjectsCompanion({
    this.projectRoot = const Value.absent(),
    this.displayName = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.lastOpenedAt = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ProjectsCompanion.insert({
    required String projectRoot,
    required String displayName,
    required DateTime createdAt,
    required DateTime lastOpenedAt,
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : projectRoot = Value(projectRoot),
        displayName = Value(displayName),
        createdAt = Value(createdAt),
        lastOpenedAt = Value(lastOpenedAt);
  static Insertable<ProjectRow> custom({
    Expression<String>? projectRoot,
    Expression<String>? displayName,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? lastOpenedAt,
    Expression<int>? sortOrder,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (projectRoot != null) 'project_root': projectRoot,
      if (displayName != null) 'display_name': displayName,
      if (createdAt != null) 'created_at': createdAt,
      if (lastOpenedAt != null) 'last_opened_at': lastOpenedAt,
      if (sortOrder != null) 'sort_order': sortOrder,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ProjectsCompanion copyWith(
      {Value<String>? projectRoot,
      Value<String>? displayName,
      Value<DateTime>? createdAt,
      Value<DateTime>? lastOpenedAt,
      Value<int>? sortOrder,
      Value<int>? rowid}) {
    return ProjectsCompanion(
      projectRoot: projectRoot ?? this.projectRoot,
      displayName: displayName ?? this.displayName,
      createdAt: createdAt ?? this.createdAt,
      lastOpenedAt: lastOpenedAt ?? this.lastOpenedAt,
      sortOrder: sortOrder ?? this.sortOrder,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (projectRoot.present) {
      map['project_root'] = Variable<String>(projectRoot.value);
    }
    if (displayName.present) {
      map['display_name'] = Variable<String>(displayName.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (lastOpenedAt.present) {
      map['last_opened_at'] = Variable<DateTime>(lastOpenedAt.value);
    }
    if (sortOrder.present) {
      map['sort_order'] = Variable<int>(sortOrder.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ProjectsCompanion(')
          ..write('projectRoot: $projectRoot, ')
          ..write('displayName: $displayName, ')
          ..write('createdAt: $createdAt, ')
          ..write('lastOpenedAt: $lastOpenedAt, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $ChatsTable extends Chats with TableInfo<$ChatsTable, ChatRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $ChatsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _chatIdMeta = const VerificationMeta('chatId');
  @override
  late final GeneratedColumn<String> chatId = GeneratedColumn<String>(
      'chat_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _projectRootMeta =
      const VerificationMeta('projectRoot');
  @override
  late final GeneratedColumn<String> projectRoot = GeneratedColumn<String>(
      'project_root', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: true,
      defaultConstraints: GeneratedColumn.constraintIsAlways(
          'REFERENCES projects (project_root) ON DELETE CASCADE'));
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
      'title', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _agentIdMeta =
      const VerificationMeta('agentId');
  @override
  late final GeneratedColumn<String> agentId = GeneratedColumn<String>(
      'agent_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _skillIdMeta =
      const VerificationMeta('skillId');
  @override
  late final GeneratedColumn<String> skillId = GeneratedColumn<String>(
      'skill_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _sessionIdMeta =
      const VerificationMeta('sessionId');
  @override
  late final GeneratedColumn<String> sessionId = GeneratedColumn<String>(
      'session_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _lastActivityAtMeta =
      const VerificationMeta('lastActivityAt');
  @override
  late final GeneratedColumn<DateTime> lastActivityAt =
      GeneratedColumn<DateTime>('last_activity_at', aliasedName, false,
          type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _sortOrderMeta =
      const VerificationMeta('sortOrder');
  @override
  late final GeneratedColumn<int> sortOrder = GeneratedColumn<int>(
      'sort_order', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  @override
  List<GeneratedColumn> get $columns => [
        chatId,
        projectRoot,
        title,
        agentId,
        skillId,
        sessionId,
        createdAt,
        lastActivityAt,
        sortOrder
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'chats';
  @override
  VerificationContext validateIntegrity(Insertable<ChatRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('chat_id')) {
      context.handle(_chatIdMeta,
          chatId.isAcceptableOrUnknown(data['chat_id']!, _chatIdMeta));
    } else if (isInserting) {
      context.missing(_chatIdMeta);
    }
    if (data.containsKey('project_root')) {
      context.handle(
          _projectRootMeta,
          projectRoot.isAcceptableOrUnknown(
              data['project_root']!, _projectRootMeta));
    } else if (isInserting) {
      context.missing(_projectRootMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
          _titleMeta, title.isAcceptableOrUnknown(data['title']!, _titleMeta));
    } else if (isInserting) {
      context.missing(_titleMeta);
    }
    if (data.containsKey('agent_id')) {
      context.handle(_agentIdMeta,
          agentId.isAcceptableOrUnknown(data['agent_id']!, _agentIdMeta));
    } else if (isInserting) {
      context.missing(_agentIdMeta);
    }
    if (data.containsKey('skill_id')) {
      context.handle(_skillIdMeta,
          skillId.isAcceptableOrUnknown(data['skill_id']!, _skillIdMeta));
    }
    if (data.containsKey('session_id')) {
      context.handle(_sessionIdMeta,
          sessionId.isAcceptableOrUnknown(data['session_id']!, _sessionIdMeta));
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('last_activity_at')) {
      context.handle(
          _lastActivityAtMeta,
          lastActivityAt.isAcceptableOrUnknown(
              data['last_activity_at']!, _lastActivityAtMeta));
    } else if (isInserting) {
      context.missing(_lastActivityAtMeta);
    }
    if (data.containsKey('sort_order')) {
      context.handle(_sortOrderMeta,
          sortOrder.isAcceptableOrUnknown(data['sort_order']!, _sortOrderMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {chatId};
  @override
  ChatRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return ChatRow(
      chatId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}chat_id'])!,
      projectRoot: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}project_root'])!,
      title: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}title'])!,
      agentId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}agent_id'])!,
      skillId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}skill_id']),
      sessionId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}session_id']),
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
      lastActivityAt: attachedDatabase.typeMapping.read(
          DriftSqlType.dateTime, data['${effectivePrefix}last_activity_at'])!,
      sortOrder: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}sort_order'])!,
    );
  }

  @override
  $ChatsTable createAlias(String alias) {
    return $ChatsTable(attachedDatabase, alias);
  }
}

class ChatRow extends DataClass implements Insertable<ChatRow> {
  final String chatId;
  final String projectRoot;
  final String title;
  final String agentId;
  final String? skillId;
  final String? sessionId;
  final DateTime createdAt;
  final DateTime lastActivityAt;
  final int sortOrder;
  const ChatRow(
      {required this.chatId,
      required this.projectRoot,
      required this.title,
      required this.agentId,
      this.skillId,
      this.sessionId,
      required this.createdAt,
      required this.lastActivityAt,
      required this.sortOrder});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['chat_id'] = Variable<String>(chatId);
    map['project_root'] = Variable<String>(projectRoot);
    map['title'] = Variable<String>(title);
    map['agent_id'] = Variable<String>(agentId);
    if (!nullToAbsent || skillId != null) {
      map['skill_id'] = Variable<String>(skillId);
    }
    if (!nullToAbsent || sessionId != null) {
      map['session_id'] = Variable<String>(sessionId);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    map['last_activity_at'] = Variable<DateTime>(lastActivityAt);
    map['sort_order'] = Variable<int>(sortOrder);
    return map;
  }

  ChatsCompanion toCompanion(bool nullToAbsent) {
    return ChatsCompanion(
      chatId: Value(chatId),
      projectRoot: Value(projectRoot),
      title: Value(title),
      agentId: Value(agentId),
      skillId: skillId == null && nullToAbsent
          ? const Value.absent()
          : Value(skillId),
      sessionId: sessionId == null && nullToAbsent
          ? const Value.absent()
          : Value(sessionId),
      createdAt: Value(createdAt),
      lastActivityAt: Value(lastActivityAt),
      sortOrder: Value(sortOrder),
    );
  }

  factory ChatRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return ChatRow(
      chatId: serializer.fromJson<String>(json['chatId']),
      projectRoot: serializer.fromJson<String>(json['projectRoot']),
      title: serializer.fromJson<String>(json['title']),
      agentId: serializer.fromJson<String>(json['agentId']),
      skillId: serializer.fromJson<String?>(json['skillId']),
      sessionId: serializer.fromJson<String?>(json['sessionId']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      lastActivityAt: serializer.fromJson<DateTime>(json['lastActivityAt']),
      sortOrder: serializer.fromJson<int>(json['sortOrder']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'chatId': serializer.toJson<String>(chatId),
      'projectRoot': serializer.toJson<String>(projectRoot),
      'title': serializer.toJson<String>(title),
      'agentId': serializer.toJson<String>(agentId),
      'skillId': serializer.toJson<String?>(skillId),
      'sessionId': serializer.toJson<String?>(sessionId),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'lastActivityAt': serializer.toJson<DateTime>(lastActivityAt),
      'sortOrder': serializer.toJson<int>(sortOrder),
    };
  }

  ChatRow copyWith(
          {String? chatId,
          String? projectRoot,
          String? title,
          String? agentId,
          Value<String?> skillId = const Value.absent(),
          Value<String?> sessionId = const Value.absent(),
          DateTime? createdAt,
          DateTime? lastActivityAt,
          int? sortOrder}) =>
      ChatRow(
        chatId: chatId ?? this.chatId,
        projectRoot: projectRoot ?? this.projectRoot,
        title: title ?? this.title,
        agentId: agentId ?? this.agentId,
        skillId: skillId.present ? skillId.value : this.skillId,
        sessionId: sessionId.present ? sessionId.value : this.sessionId,
        createdAt: createdAt ?? this.createdAt,
        lastActivityAt: lastActivityAt ?? this.lastActivityAt,
        sortOrder: sortOrder ?? this.sortOrder,
      );
  ChatRow copyWithCompanion(ChatsCompanion data) {
    return ChatRow(
      chatId: data.chatId.present ? data.chatId.value : this.chatId,
      projectRoot:
          data.projectRoot.present ? data.projectRoot.value : this.projectRoot,
      title: data.title.present ? data.title.value : this.title,
      agentId: data.agentId.present ? data.agentId.value : this.agentId,
      skillId: data.skillId.present ? data.skillId.value : this.skillId,
      sessionId: data.sessionId.present ? data.sessionId.value : this.sessionId,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      lastActivityAt: data.lastActivityAt.present
          ? data.lastActivityAt.value
          : this.lastActivityAt,
      sortOrder: data.sortOrder.present ? data.sortOrder.value : this.sortOrder,
    );
  }

  @override
  String toString() {
    return (StringBuffer('ChatRow(')
          ..write('chatId: $chatId, ')
          ..write('projectRoot: $projectRoot, ')
          ..write('title: $title, ')
          ..write('agentId: $agentId, ')
          ..write('skillId: $skillId, ')
          ..write('sessionId: $sessionId, ')
          ..write('createdAt: $createdAt, ')
          ..write('lastActivityAt: $lastActivityAt, ')
          ..write('sortOrder: $sortOrder')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(chatId, projectRoot, title, agentId, skillId,
      sessionId, createdAt, lastActivityAt, sortOrder);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is ChatRow &&
          other.chatId == this.chatId &&
          other.projectRoot == this.projectRoot &&
          other.title == this.title &&
          other.agentId == this.agentId &&
          other.skillId == this.skillId &&
          other.sessionId == this.sessionId &&
          other.createdAt == this.createdAt &&
          other.lastActivityAt == this.lastActivityAt &&
          other.sortOrder == this.sortOrder);
}

class ChatsCompanion extends UpdateCompanion<ChatRow> {
  final Value<String> chatId;
  final Value<String> projectRoot;
  final Value<String> title;
  final Value<String> agentId;
  final Value<String?> skillId;
  final Value<String?> sessionId;
  final Value<DateTime> createdAt;
  final Value<DateTime> lastActivityAt;
  final Value<int> sortOrder;
  final Value<int> rowid;
  const ChatsCompanion({
    this.chatId = const Value.absent(),
    this.projectRoot = const Value.absent(),
    this.title = const Value.absent(),
    this.agentId = const Value.absent(),
    this.skillId = const Value.absent(),
    this.sessionId = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.lastActivityAt = const Value.absent(),
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  ChatsCompanion.insert({
    required String chatId,
    required String projectRoot,
    required String title,
    required String agentId,
    this.skillId = const Value.absent(),
    this.sessionId = const Value.absent(),
    required DateTime createdAt,
    required DateTime lastActivityAt,
    this.sortOrder = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : chatId = Value(chatId),
        projectRoot = Value(projectRoot),
        title = Value(title),
        agentId = Value(agentId),
        createdAt = Value(createdAt),
        lastActivityAt = Value(lastActivityAt);
  static Insertable<ChatRow> custom({
    Expression<String>? chatId,
    Expression<String>? projectRoot,
    Expression<String>? title,
    Expression<String>? agentId,
    Expression<String>? skillId,
    Expression<String>? sessionId,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? lastActivityAt,
    Expression<int>? sortOrder,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (chatId != null) 'chat_id': chatId,
      if (projectRoot != null) 'project_root': projectRoot,
      if (title != null) 'title': title,
      if (agentId != null) 'agent_id': agentId,
      if (skillId != null) 'skill_id': skillId,
      if (sessionId != null) 'session_id': sessionId,
      if (createdAt != null) 'created_at': createdAt,
      if (lastActivityAt != null) 'last_activity_at': lastActivityAt,
      if (sortOrder != null) 'sort_order': sortOrder,
      if (rowid != null) 'rowid': rowid,
    });
  }

  ChatsCompanion copyWith(
      {Value<String>? chatId,
      Value<String>? projectRoot,
      Value<String>? title,
      Value<String>? agentId,
      Value<String?>? skillId,
      Value<String?>? sessionId,
      Value<DateTime>? createdAt,
      Value<DateTime>? lastActivityAt,
      Value<int>? sortOrder,
      Value<int>? rowid}) {
    return ChatsCompanion(
      chatId: chatId ?? this.chatId,
      projectRoot: projectRoot ?? this.projectRoot,
      title: title ?? this.title,
      agentId: agentId ?? this.agentId,
      skillId: skillId ?? this.skillId,
      sessionId: sessionId ?? this.sessionId,
      createdAt: createdAt ?? this.createdAt,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
      sortOrder: sortOrder ?? this.sortOrder,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (chatId.present) {
      map['chat_id'] = Variable<String>(chatId.value);
    }
    if (projectRoot.present) {
      map['project_root'] = Variable<String>(projectRoot.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (agentId.present) {
      map['agent_id'] = Variable<String>(agentId.value);
    }
    if (skillId.present) {
      map['skill_id'] = Variable<String>(skillId.value);
    }
    if (sessionId.present) {
      map['session_id'] = Variable<String>(sessionId.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (lastActivityAt.present) {
      map['last_activity_at'] = Variable<DateTime>(lastActivityAt.value);
    }
    if (sortOrder.present) {
      map['sort_order'] = Variable<int>(sortOrder.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('ChatsCompanion(')
          ..write('chatId: $chatId, ')
          ..write('projectRoot: $projectRoot, ')
          ..write('title: $title, ')
          ..write('agentId: $agentId, ')
          ..write('skillId: $skillId, ')
          ..write('sessionId: $sessionId, ')
          ..write('createdAt: $createdAt, ')
          ..write('lastActivityAt: $lastActivityAt, ')
          ..write('sortOrder: $sortOrder, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $RunSessionLogTable extends RunSessionLog
    with TableInfo<$RunSessionLogTable, RunSessionLogRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $RunSessionLogTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _sessionIdMeta =
      const VerificationMeta('sessionId');
  @override
  late final GeneratedColumn<String> sessionId = GeneratedColumn<String>(
      'session_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _projectRootMeta =
      const VerificationMeta('projectRoot');
  @override
  late final GeneratedColumn<String> projectRoot = GeneratedColumn<String>(
      'project_root', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _startedAtMeta =
      const VerificationMeta('startedAt');
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
      'started_at', aliasedName, false,
      type: DriftSqlType.dateTime, requiredDuringInsert: true);
  static const VerificationMeta _endedAtMeta =
      const VerificationMeta('endedAt');
  @override
  late final GeneratedColumn<DateTime> endedAt = GeneratedColumn<DateTime>(
      'ended_at', aliasedName, true,
      type: DriftSqlType.dateTime, requiredDuringInsert: false);
  static const VerificationMeta _avdIdMeta = const VerificationMeta('avdId');
  @override
  late final GeneratedColumn<String> avdId = GeneratedColumn<String>(
      'avd_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _avdNameMeta =
      const VerificationMeta('avdName');
  @override
  late final GeneratedColumn<String> avdName = GeneratedColumn<String>(
      'avd_name', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _serialMeta = const VerificationMeta('serial');
  @override
  late final GeneratedColumn<String> serial = GeneratedColumn<String>(
      'serial', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _vmServiceUrlMeta =
      const VerificationMeta('vmServiceUrl');
  @override
  late final GeneratedColumn<String> vmServiceUrl = GeneratedColumn<String>(
      'vm_service_url', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _connectionModeMeta =
      const VerificationMeta('connectionMode');
  @override
  late final GeneratedColumn<String> connectionMode = GeneratedColumn<String>(
      'connection_mode', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _exitReasonMeta =
      const VerificationMeta('exitReason');
  @override
  late final GeneratedColumn<String> exitReason = GeneratedColumn<String>(
      'exit_reason', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _exitCodeMeta =
      const VerificationMeta('exitCode');
  @override
  late final GeneratedColumn<int> exitCode = GeneratedColumn<int>(
      'exit_code', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _hotReloadCountMeta =
      const VerificationMeta('hotReloadCount');
  @override
  late final GeneratedColumn<int> hotReloadCount = GeneratedColumn<int>(
      'hot_reload_count', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _hotRestartCountMeta =
      const VerificationMeta('hotRestartCount');
  @override
  late final GeneratedColumn<int> hotRestartCount = GeneratedColumn<int>(
      'hot_restart_count', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _errorCountMeta =
      const VerificationMeta('errorCount');
  @override
  late final GeneratedColumn<int> errorCount = GeneratedColumn<int>(
      'error_count', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _lastErrorMeta =
      const VerificationMeta('lastError');
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
      'last_error', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  @override
  List<GeneratedColumn> get $columns => [
        sessionId,
        projectRoot,
        startedAt,
        endedAt,
        avdId,
        avdName,
        serial,
        vmServiceUrl,
        connectionMode,
        exitReason,
        exitCode,
        hotReloadCount,
        hotRestartCount,
        errorCount,
        lastError
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'run_session_log';
  @override
  VerificationContext validateIntegrity(Insertable<RunSessionLogRow> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('session_id')) {
      context.handle(_sessionIdMeta,
          sessionId.isAcceptableOrUnknown(data['session_id']!, _sessionIdMeta));
    } else if (isInserting) {
      context.missing(_sessionIdMeta);
    }
    if (data.containsKey('project_root')) {
      context.handle(
          _projectRootMeta,
          projectRoot.isAcceptableOrUnknown(
              data['project_root']!, _projectRootMeta));
    } else if (isInserting) {
      context.missing(_projectRootMeta);
    }
    if (data.containsKey('started_at')) {
      context.handle(_startedAtMeta,
          startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta));
    } else if (isInserting) {
      context.missing(_startedAtMeta);
    }
    if (data.containsKey('ended_at')) {
      context.handle(_endedAtMeta,
          endedAt.isAcceptableOrUnknown(data['ended_at']!, _endedAtMeta));
    }
    if (data.containsKey('avd_id')) {
      context.handle(
          _avdIdMeta, avdId.isAcceptableOrUnknown(data['avd_id']!, _avdIdMeta));
    }
    if (data.containsKey('avd_name')) {
      context.handle(_avdNameMeta,
          avdName.isAcceptableOrUnknown(data['avd_name']!, _avdNameMeta));
    }
    if (data.containsKey('serial')) {
      context.handle(_serialMeta,
          serial.isAcceptableOrUnknown(data['serial']!, _serialMeta));
    }
    if (data.containsKey('vm_service_url')) {
      context.handle(
          _vmServiceUrlMeta,
          vmServiceUrl.isAcceptableOrUnknown(
              data['vm_service_url']!, _vmServiceUrlMeta));
    }
    if (data.containsKey('connection_mode')) {
      context.handle(
          _connectionModeMeta,
          connectionMode.isAcceptableOrUnknown(
              data['connection_mode']!, _connectionModeMeta));
    } else if (isInserting) {
      context.missing(_connectionModeMeta);
    }
    if (data.containsKey('exit_reason')) {
      context.handle(
          _exitReasonMeta,
          exitReason.isAcceptableOrUnknown(
              data['exit_reason']!, _exitReasonMeta));
    }
    if (data.containsKey('exit_code')) {
      context.handle(_exitCodeMeta,
          exitCode.isAcceptableOrUnknown(data['exit_code']!, _exitCodeMeta));
    }
    if (data.containsKey('hot_reload_count')) {
      context.handle(
          _hotReloadCountMeta,
          hotReloadCount.isAcceptableOrUnknown(
              data['hot_reload_count']!, _hotReloadCountMeta));
    }
    if (data.containsKey('hot_restart_count')) {
      context.handle(
          _hotRestartCountMeta,
          hotRestartCount.isAcceptableOrUnknown(
              data['hot_restart_count']!, _hotRestartCountMeta));
    }
    if (data.containsKey('error_count')) {
      context.handle(
          _errorCountMeta,
          errorCount.isAcceptableOrUnknown(
              data['error_count']!, _errorCountMeta));
    }
    if (data.containsKey('last_error')) {
      context.handle(_lastErrorMeta,
          lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {sessionId};
  @override
  RunSessionLogRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return RunSessionLogRow(
      sessionId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}session_id'])!,
      projectRoot: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}project_root'])!,
      startedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}started_at'])!,
      endedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}ended_at']),
      avdId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}avd_id']),
      avdName: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}avd_name']),
      serial: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}serial']),
      vmServiceUrl: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}vm_service_url']),
      connectionMode: attachedDatabase.typeMapping.read(
          DriftSqlType.string, data['${effectivePrefix}connection_mode'])!,
      exitReason: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}exit_reason']),
      exitCode: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}exit_code']),
      hotReloadCount: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}hot_reload_count'])!,
      hotRestartCount: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}hot_restart_count'])!,
      errorCount: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}error_count'])!,
      lastError: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}last_error']),
    );
  }

  @override
  $RunSessionLogTable createAlias(String alias) {
    return $RunSessionLogTable(attachedDatabase, alias);
  }
}

class RunSessionLogRow extends DataClass
    implements Insertable<RunSessionLogRow> {
  final String sessionId;
  final String projectRoot;
  final DateTime startedAt;
  final DateTime? endedAt;
  final String? avdId;
  final String? avdName;
  final String? serial;
  final String? vmServiceUrl;
  final String connectionMode;
  final String? exitReason;
  final int? exitCode;
  final int hotReloadCount;
  final int hotRestartCount;
  final int errorCount;
  final String? lastError;
  const RunSessionLogRow(
      {required this.sessionId,
      required this.projectRoot,
      required this.startedAt,
      this.endedAt,
      this.avdId,
      this.avdName,
      this.serial,
      this.vmServiceUrl,
      required this.connectionMode,
      this.exitReason,
      this.exitCode,
      required this.hotReloadCount,
      required this.hotRestartCount,
      required this.errorCount,
      this.lastError});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['session_id'] = Variable<String>(sessionId);
    map['project_root'] = Variable<String>(projectRoot);
    map['started_at'] = Variable<DateTime>(startedAt);
    if (!nullToAbsent || endedAt != null) {
      map['ended_at'] = Variable<DateTime>(endedAt);
    }
    if (!nullToAbsent || avdId != null) {
      map['avd_id'] = Variable<String>(avdId);
    }
    if (!nullToAbsent || avdName != null) {
      map['avd_name'] = Variable<String>(avdName);
    }
    if (!nullToAbsent || serial != null) {
      map['serial'] = Variable<String>(serial);
    }
    if (!nullToAbsent || vmServiceUrl != null) {
      map['vm_service_url'] = Variable<String>(vmServiceUrl);
    }
    map['connection_mode'] = Variable<String>(connectionMode);
    if (!nullToAbsent || exitReason != null) {
      map['exit_reason'] = Variable<String>(exitReason);
    }
    if (!nullToAbsent || exitCode != null) {
      map['exit_code'] = Variable<int>(exitCode);
    }
    map['hot_reload_count'] = Variable<int>(hotReloadCount);
    map['hot_restart_count'] = Variable<int>(hotRestartCount);
    map['error_count'] = Variable<int>(errorCount);
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    return map;
  }

  RunSessionLogCompanion toCompanion(bool nullToAbsent) {
    return RunSessionLogCompanion(
      sessionId: Value(sessionId),
      projectRoot: Value(projectRoot),
      startedAt: Value(startedAt),
      endedAt: endedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(endedAt),
      avdId:
          avdId == null && nullToAbsent ? const Value.absent() : Value(avdId),
      avdName: avdName == null && nullToAbsent
          ? const Value.absent()
          : Value(avdName),
      serial:
          serial == null && nullToAbsent ? const Value.absent() : Value(serial),
      vmServiceUrl: vmServiceUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(vmServiceUrl),
      connectionMode: Value(connectionMode),
      exitReason: exitReason == null && nullToAbsent
          ? const Value.absent()
          : Value(exitReason),
      exitCode: exitCode == null && nullToAbsent
          ? const Value.absent()
          : Value(exitCode),
      hotReloadCount: Value(hotReloadCount),
      hotRestartCount: Value(hotRestartCount),
      errorCount: Value(errorCount),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
    );
  }

  factory RunSessionLogRow.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return RunSessionLogRow(
      sessionId: serializer.fromJson<String>(json['sessionId']),
      projectRoot: serializer.fromJson<String>(json['projectRoot']),
      startedAt: serializer.fromJson<DateTime>(json['startedAt']),
      endedAt: serializer.fromJson<DateTime?>(json['endedAt']),
      avdId: serializer.fromJson<String?>(json['avdId']),
      avdName: serializer.fromJson<String?>(json['avdName']),
      serial: serializer.fromJson<String?>(json['serial']),
      vmServiceUrl: serializer.fromJson<String?>(json['vmServiceUrl']),
      connectionMode: serializer.fromJson<String>(json['connectionMode']),
      exitReason: serializer.fromJson<String?>(json['exitReason']),
      exitCode: serializer.fromJson<int?>(json['exitCode']),
      hotReloadCount: serializer.fromJson<int>(json['hotReloadCount']),
      hotRestartCount: serializer.fromJson<int>(json['hotRestartCount']),
      errorCount: serializer.fromJson<int>(json['errorCount']),
      lastError: serializer.fromJson<String?>(json['lastError']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'sessionId': serializer.toJson<String>(sessionId),
      'projectRoot': serializer.toJson<String>(projectRoot),
      'startedAt': serializer.toJson<DateTime>(startedAt),
      'endedAt': serializer.toJson<DateTime?>(endedAt),
      'avdId': serializer.toJson<String?>(avdId),
      'avdName': serializer.toJson<String?>(avdName),
      'serial': serializer.toJson<String?>(serial),
      'vmServiceUrl': serializer.toJson<String?>(vmServiceUrl),
      'connectionMode': serializer.toJson<String>(connectionMode),
      'exitReason': serializer.toJson<String?>(exitReason),
      'exitCode': serializer.toJson<int?>(exitCode),
      'hotReloadCount': serializer.toJson<int>(hotReloadCount),
      'hotRestartCount': serializer.toJson<int>(hotRestartCount),
      'errorCount': serializer.toJson<int>(errorCount),
      'lastError': serializer.toJson<String?>(lastError),
    };
  }

  RunSessionLogRow copyWith(
          {String? sessionId,
          String? projectRoot,
          DateTime? startedAt,
          Value<DateTime?> endedAt = const Value.absent(),
          Value<String?> avdId = const Value.absent(),
          Value<String?> avdName = const Value.absent(),
          Value<String?> serial = const Value.absent(),
          Value<String?> vmServiceUrl = const Value.absent(),
          String? connectionMode,
          Value<String?> exitReason = const Value.absent(),
          Value<int?> exitCode = const Value.absent(),
          int? hotReloadCount,
          int? hotRestartCount,
          int? errorCount,
          Value<String?> lastError = const Value.absent()}) =>
      RunSessionLogRow(
        sessionId: sessionId ?? this.sessionId,
        projectRoot: projectRoot ?? this.projectRoot,
        startedAt: startedAt ?? this.startedAt,
        endedAt: endedAt.present ? endedAt.value : this.endedAt,
        avdId: avdId.present ? avdId.value : this.avdId,
        avdName: avdName.present ? avdName.value : this.avdName,
        serial: serial.present ? serial.value : this.serial,
        vmServiceUrl:
            vmServiceUrl.present ? vmServiceUrl.value : this.vmServiceUrl,
        connectionMode: connectionMode ?? this.connectionMode,
        exitReason: exitReason.present ? exitReason.value : this.exitReason,
        exitCode: exitCode.present ? exitCode.value : this.exitCode,
        hotReloadCount: hotReloadCount ?? this.hotReloadCount,
        hotRestartCount: hotRestartCount ?? this.hotRestartCount,
        errorCount: errorCount ?? this.errorCount,
        lastError: lastError.present ? lastError.value : this.lastError,
      );
  RunSessionLogRow copyWithCompanion(RunSessionLogCompanion data) {
    return RunSessionLogRow(
      sessionId: data.sessionId.present ? data.sessionId.value : this.sessionId,
      projectRoot:
          data.projectRoot.present ? data.projectRoot.value : this.projectRoot,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      endedAt: data.endedAt.present ? data.endedAt.value : this.endedAt,
      avdId: data.avdId.present ? data.avdId.value : this.avdId,
      avdName: data.avdName.present ? data.avdName.value : this.avdName,
      serial: data.serial.present ? data.serial.value : this.serial,
      vmServiceUrl: data.vmServiceUrl.present
          ? data.vmServiceUrl.value
          : this.vmServiceUrl,
      connectionMode: data.connectionMode.present
          ? data.connectionMode.value
          : this.connectionMode,
      exitReason:
          data.exitReason.present ? data.exitReason.value : this.exitReason,
      exitCode: data.exitCode.present ? data.exitCode.value : this.exitCode,
      hotReloadCount: data.hotReloadCount.present
          ? data.hotReloadCount.value
          : this.hotReloadCount,
      hotRestartCount: data.hotRestartCount.present
          ? data.hotRestartCount.value
          : this.hotRestartCount,
      errorCount:
          data.errorCount.present ? data.errorCount.value : this.errorCount,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
    );
  }

  @override
  String toString() {
    return (StringBuffer('RunSessionLogRow(')
          ..write('sessionId: $sessionId, ')
          ..write('projectRoot: $projectRoot, ')
          ..write('startedAt: $startedAt, ')
          ..write('endedAt: $endedAt, ')
          ..write('avdId: $avdId, ')
          ..write('avdName: $avdName, ')
          ..write('serial: $serial, ')
          ..write('vmServiceUrl: $vmServiceUrl, ')
          ..write('connectionMode: $connectionMode, ')
          ..write('exitReason: $exitReason, ')
          ..write('exitCode: $exitCode, ')
          ..write('hotReloadCount: $hotReloadCount, ')
          ..write('hotRestartCount: $hotRestartCount, ')
          ..write('errorCount: $errorCount, ')
          ..write('lastError: $lastError')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
      sessionId,
      projectRoot,
      startedAt,
      endedAt,
      avdId,
      avdName,
      serial,
      vmServiceUrl,
      connectionMode,
      exitReason,
      exitCode,
      hotReloadCount,
      hotRestartCount,
      errorCount,
      lastError);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is RunSessionLogRow &&
          other.sessionId == this.sessionId &&
          other.projectRoot == this.projectRoot &&
          other.startedAt == this.startedAt &&
          other.endedAt == this.endedAt &&
          other.avdId == this.avdId &&
          other.avdName == this.avdName &&
          other.serial == this.serial &&
          other.vmServiceUrl == this.vmServiceUrl &&
          other.connectionMode == this.connectionMode &&
          other.exitReason == this.exitReason &&
          other.exitCode == this.exitCode &&
          other.hotReloadCount == this.hotReloadCount &&
          other.hotRestartCount == this.hotRestartCount &&
          other.errorCount == this.errorCount &&
          other.lastError == this.lastError);
}

class RunSessionLogCompanion extends UpdateCompanion<RunSessionLogRow> {
  final Value<String> sessionId;
  final Value<String> projectRoot;
  final Value<DateTime> startedAt;
  final Value<DateTime?> endedAt;
  final Value<String?> avdId;
  final Value<String?> avdName;
  final Value<String?> serial;
  final Value<String?> vmServiceUrl;
  final Value<String> connectionMode;
  final Value<String?> exitReason;
  final Value<int?> exitCode;
  final Value<int> hotReloadCount;
  final Value<int> hotRestartCount;
  final Value<int> errorCount;
  final Value<String?> lastError;
  final Value<int> rowid;
  const RunSessionLogCompanion({
    this.sessionId = const Value.absent(),
    this.projectRoot = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.endedAt = const Value.absent(),
    this.avdId = const Value.absent(),
    this.avdName = const Value.absent(),
    this.serial = const Value.absent(),
    this.vmServiceUrl = const Value.absent(),
    this.connectionMode = const Value.absent(),
    this.exitReason = const Value.absent(),
    this.exitCode = const Value.absent(),
    this.hotReloadCount = const Value.absent(),
    this.hotRestartCount = const Value.absent(),
    this.errorCount = const Value.absent(),
    this.lastError = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  RunSessionLogCompanion.insert({
    required String sessionId,
    required String projectRoot,
    required DateTime startedAt,
    this.endedAt = const Value.absent(),
    this.avdId = const Value.absent(),
    this.avdName = const Value.absent(),
    this.serial = const Value.absent(),
    this.vmServiceUrl = const Value.absent(),
    required String connectionMode,
    this.exitReason = const Value.absent(),
    this.exitCode = const Value.absent(),
    this.hotReloadCount = const Value.absent(),
    this.hotRestartCount = const Value.absent(),
    this.errorCount = const Value.absent(),
    this.lastError = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : sessionId = Value(sessionId),
        projectRoot = Value(projectRoot),
        startedAt = Value(startedAt),
        connectionMode = Value(connectionMode);
  static Insertable<RunSessionLogRow> custom({
    Expression<String>? sessionId,
    Expression<String>? projectRoot,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? endedAt,
    Expression<String>? avdId,
    Expression<String>? avdName,
    Expression<String>? serial,
    Expression<String>? vmServiceUrl,
    Expression<String>? connectionMode,
    Expression<String>? exitReason,
    Expression<int>? exitCode,
    Expression<int>? hotReloadCount,
    Expression<int>? hotRestartCount,
    Expression<int>? errorCount,
    Expression<String>? lastError,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (sessionId != null) 'session_id': sessionId,
      if (projectRoot != null) 'project_root': projectRoot,
      if (startedAt != null) 'started_at': startedAt,
      if (endedAt != null) 'ended_at': endedAt,
      if (avdId != null) 'avd_id': avdId,
      if (avdName != null) 'avd_name': avdName,
      if (serial != null) 'serial': serial,
      if (vmServiceUrl != null) 'vm_service_url': vmServiceUrl,
      if (connectionMode != null) 'connection_mode': connectionMode,
      if (exitReason != null) 'exit_reason': exitReason,
      if (exitCode != null) 'exit_code': exitCode,
      if (hotReloadCount != null) 'hot_reload_count': hotReloadCount,
      if (hotRestartCount != null) 'hot_restart_count': hotRestartCount,
      if (errorCount != null) 'error_count': errorCount,
      if (lastError != null) 'last_error': lastError,
      if (rowid != null) 'rowid': rowid,
    });
  }

  RunSessionLogCompanion copyWith(
      {Value<String>? sessionId,
      Value<String>? projectRoot,
      Value<DateTime>? startedAt,
      Value<DateTime?>? endedAt,
      Value<String?>? avdId,
      Value<String?>? avdName,
      Value<String?>? serial,
      Value<String?>? vmServiceUrl,
      Value<String>? connectionMode,
      Value<String?>? exitReason,
      Value<int?>? exitCode,
      Value<int>? hotReloadCount,
      Value<int>? hotRestartCount,
      Value<int>? errorCount,
      Value<String?>? lastError,
      Value<int>? rowid}) {
    return RunSessionLogCompanion(
      sessionId: sessionId ?? this.sessionId,
      projectRoot: projectRoot ?? this.projectRoot,
      startedAt: startedAt ?? this.startedAt,
      endedAt: endedAt ?? this.endedAt,
      avdId: avdId ?? this.avdId,
      avdName: avdName ?? this.avdName,
      serial: serial ?? this.serial,
      vmServiceUrl: vmServiceUrl ?? this.vmServiceUrl,
      connectionMode: connectionMode ?? this.connectionMode,
      exitReason: exitReason ?? this.exitReason,
      exitCode: exitCode ?? this.exitCode,
      hotReloadCount: hotReloadCount ?? this.hotReloadCount,
      hotRestartCount: hotRestartCount ?? this.hotRestartCount,
      errorCount: errorCount ?? this.errorCount,
      lastError: lastError ?? this.lastError,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (sessionId.present) {
      map['session_id'] = Variable<String>(sessionId.value);
    }
    if (projectRoot.present) {
      map['project_root'] = Variable<String>(projectRoot.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (endedAt.present) {
      map['ended_at'] = Variable<DateTime>(endedAt.value);
    }
    if (avdId.present) {
      map['avd_id'] = Variable<String>(avdId.value);
    }
    if (avdName.present) {
      map['avd_name'] = Variable<String>(avdName.value);
    }
    if (serial.present) {
      map['serial'] = Variable<String>(serial.value);
    }
    if (vmServiceUrl.present) {
      map['vm_service_url'] = Variable<String>(vmServiceUrl.value);
    }
    if (connectionMode.present) {
      map['connection_mode'] = Variable<String>(connectionMode.value);
    }
    if (exitReason.present) {
      map['exit_reason'] = Variable<String>(exitReason.value);
    }
    if (exitCode.present) {
      map['exit_code'] = Variable<int>(exitCode.value);
    }
    if (hotReloadCount.present) {
      map['hot_reload_count'] = Variable<int>(hotReloadCount.value);
    }
    if (hotRestartCount.present) {
      map['hot_restart_count'] = Variable<int>(hotRestartCount.value);
    }
    if (errorCount.present) {
      map['error_count'] = Variable<int>(errorCount.value);
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('RunSessionLogCompanion(')
          ..write('sessionId: $sessionId, ')
          ..write('projectRoot: $projectRoot, ')
          ..write('startedAt: $startedAt, ')
          ..write('endedAt: $endedAt, ')
          ..write('avdId: $avdId, ')
          ..write('avdName: $avdName, ')
          ..write('serial: $serial, ')
          ..write('vmServiceUrl: $vmServiceUrl, ')
          ..write('connectionMode: $connectionMode, ')
          ..write('exitReason: $exitReason, ')
          ..write('exitCode: $exitCode, ')
          ..write('hotReloadCount: $hotReloadCount, ')
          ..write('hotRestartCount: $hotRestartCount, ')
          ..write('errorCount: $errorCount, ')
          ..write('lastError: $lastError, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$PickforgeDatabase extends GeneratedDatabase {
  _$PickforgeDatabase(QueryExecutor e) : super(e);
  $PickforgeDatabaseManager get managers => $PickforgeDatabaseManager(this);
  late final $ProjectSettingsTable projectSettings =
      $ProjectSettingsTable(this);
  late final $PickHistoryTable pickHistory = $PickHistoryTable(this);
  late final $AgentRunLogTable agentRunLog = $AgentRunLogTable(this);
  late final $ProjectsTable projects = $ProjectsTable(this);
  late final $ChatsTable chats = $ChatsTable(this);
  late final $RunSessionLogTable runSessionLog = $RunSessionLogTable(this);
  late final ProjectSettingsDao projectSettingsDao =
      ProjectSettingsDao(this as PickforgeDatabase);
  late final PickHistoryDao pickHistoryDao =
      PickHistoryDao(this as PickforgeDatabase);
  late final AgentRunLogDao agentRunLogDao =
      AgentRunLogDao(this as PickforgeDatabase);
  late final ProjectsDao projectsDao = ProjectsDao(this as PickforgeDatabase);
  late final ChatsDao chatsDao = ChatsDao(this as PickforgeDatabase);
  late final RunSessionLogDao runSessionLogDao =
      RunSessionLogDao(this as PickforgeDatabase);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
        projectSettings,
        pickHistory,
        agentRunLog,
        projects,
        chats,
        runSessionLog
      ];
  @override
  StreamQueryUpdateRules get streamUpdateRules => const StreamQueryUpdateRules(
        [
          WritePropagation(
            on: TableUpdateQuery.onTableName('projects',
                limitUpdateKind: UpdateKind.delete),
            result: [
              TableUpdate('chats', kind: UpdateKind.delete),
            ],
          ),
        ],
      );
}

typedef $$ProjectSettingsTableCreateCompanionBuilder = ProjectSettingsCompanion
    Function({
  required String projectRoot,
  Value<String?> vmServiceUrl,
  Value<String?> defaultAgentId,
  Value<String?> lastChatId,
  Value<String?> paneSizes,
  Value<DateTime?> lastUsedAt,
  Value<String?> avdId,
  Value<String?> avdName,
  Value<String> connectionMode,
  Value<String?> flutterRunArgs,
  Value<String?> targetFile,
  Value<bool> autoBootOnSelect,
  Value<bool> firstRunCelebrated,
  Value<int> rowid,
});
typedef $$ProjectSettingsTableUpdateCompanionBuilder = ProjectSettingsCompanion
    Function({
  Value<String> projectRoot,
  Value<String?> vmServiceUrl,
  Value<String?> defaultAgentId,
  Value<String?> lastChatId,
  Value<String?> paneSizes,
  Value<DateTime?> lastUsedAt,
  Value<String?> avdId,
  Value<String?> avdName,
  Value<String> connectionMode,
  Value<String?> flutterRunArgs,
  Value<String?> targetFile,
  Value<bool> autoBootOnSelect,
  Value<bool> firstRunCelebrated,
  Value<int> rowid,
});

class $$ProjectSettingsTableFilterComposer
    extends Composer<_$PickforgeDatabase, $ProjectSettingsTable> {
  $$ProjectSettingsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get vmServiceUrl => $composableBuilder(
      column: $table.vmServiceUrl, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get defaultAgentId => $composableBuilder(
      column: $table.defaultAgentId,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastChatId => $composableBuilder(
      column: $table.lastChatId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get paneSizes => $composableBuilder(
      column: $table.paneSizes, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get avdId => $composableBuilder(
      column: $table.avdId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get avdName => $composableBuilder(
      column: $table.avdName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get connectionMode => $composableBuilder(
      column: $table.connectionMode,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get flutterRunArgs => $composableBuilder(
      column: $table.flutterRunArgs,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get targetFile => $composableBuilder(
      column: $table.targetFile, builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get autoBootOnSelect => $composableBuilder(
      column: $table.autoBootOnSelect,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<bool> get firstRunCelebrated => $composableBuilder(
      column: $table.firstRunCelebrated,
      builder: (column) => ColumnFilters(column));
}

class $$ProjectSettingsTableOrderingComposer
    extends Composer<_$PickforgeDatabase, $ProjectSettingsTable> {
  $$ProjectSettingsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get vmServiceUrl => $composableBuilder(
      column: $table.vmServiceUrl,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get defaultAgentId => $composableBuilder(
      column: $table.defaultAgentId,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastChatId => $composableBuilder(
      column: $table.lastChatId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get paneSizes => $composableBuilder(
      column: $table.paneSizes, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get avdId => $composableBuilder(
      column: $table.avdId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get avdName => $composableBuilder(
      column: $table.avdName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get connectionMode => $composableBuilder(
      column: $table.connectionMode,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get flutterRunArgs => $composableBuilder(
      column: $table.flutterRunArgs,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get targetFile => $composableBuilder(
      column: $table.targetFile, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get autoBootOnSelect => $composableBuilder(
      column: $table.autoBootOnSelect,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<bool> get firstRunCelebrated => $composableBuilder(
      column: $table.firstRunCelebrated,
      builder: (column) => ColumnOrderings(column));
}

class $$ProjectSettingsTableAnnotationComposer
    extends Composer<_$PickforgeDatabase, $ProjectSettingsTable> {
  $$ProjectSettingsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => column);

  GeneratedColumn<String> get vmServiceUrl => $composableBuilder(
      column: $table.vmServiceUrl, builder: (column) => column);

  GeneratedColumn<String> get defaultAgentId => $composableBuilder(
      column: $table.defaultAgentId, builder: (column) => column);

  GeneratedColumn<String> get lastChatId => $composableBuilder(
      column: $table.lastChatId, builder: (column) => column);

  GeneratedColumn<String> get paneSizes =>
      $composableBuilder(column: $table.paneSizes, builder: (column) => column);

  GeneratedColumn<DateTime> get lastUsedAt => $composableBuilder(
      column: $table.lastUsedAt, builder: (column) => column);

  GeneratedColumn<String> get avdId =>
      $composableBuilder(column: $table.avdId, builder: (column) => column);

  GeneratedColumn<String> get avdName =>
      $composableBuilder(column: $table.avdName, builder: (column) => column);

  GeneratedColumn<String> get connectionMode => $composableBuilder(
      column: $table.connectionMode, builder: (column) => column);

  GeneratedColumn<String> get flutterRunArgs => $composableBuilder(
      column: $table.flutterRunArgs, builder: (column) => column);

  GeneratedColumn<String> get targetFile => $composableBuilder(
      column: $table.targetFile, builder: (column) => column);

  GeneratedColumn<bool> get autoBootOnSelect => $composableBuilder(
      column: $table.autoBootOnSelect, builder: (column) => column);

  GeneratedColumn<bool> get firstRunCelebrated => $composableBuilder(
      column: $table.firstRunCelebrated, builder: (column) => column);
}

class $$ProjectSettingsTableTableManager extends RootTableManager<
    _$PickforgeDatabase,
    $ProjectSettingsTable,
    ProjectSettingsRow,
    $$ProjectSettingsTableFilterComposer,
    $$ProjectSettingsTableOrderingComposer,
    $$ProjectSettingsTableAnnotationComposer,
    $$ProjectSettingsTableCreateCompanionBuilder,
    $$ProjectSettingsTableUpdateCompanionBuilder,
    (
      ProjectSettingsRow,
      BaseReferences<_$PickforgeDatabase, $ProjectSettingsTable,
          ProjectSettingsRow>
    ),
    ProjectSettingsRow,
    PrefetchHooks Function()> {
  $$ProjectSettingsTableTableManager(
      _$PickforgeDatabase db, $ProjectSettingsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ProjectSettingsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ProjectSettingsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ProjectSettingsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> projectRoot = const Value.absent(),
            Value<String?> vmServiceUrl = const Value.absent(),
            Value<String?> defaultAgentId = const Value.absent(),
            Value<String?> lastChatId = const Value.absent(),
            Value<String?> paneSizes = const Value.absent(),
            Value<DateTime?> lastUsedAt = const Value.absent(),
            Value<String?> avdId = const Value.absent(),
            Value<String?> avdName = const Value.absent(),
            Value<String> connectionMode = const Value.absent(),
            Value<String?> flutterRunArgs = const Value.absent(),
            Value<String?> targetFile = const Value.absent(),
            Value<bool> autoBootOnSelect = const Value.absent(),
            Value<bool> firstRunCelebrated = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ProjectSettingsCompanion(
            projectRoot: projectRoot,
            vmServiceUrl: vmServiceUrl,
            defaultAgentId: defaultAgentId,
            lastChatId: lastChatId,
            paneSizes: paneSizes,
            lastUsedAt: lastUsedAt,
            avdId: avdId,
            avdName: avdName,
            connectionMode: connectionMode,
            flutterRunArgs: flutterRunArgs,
            targetFile: targetFile,
            autoBootOnSelect: autoBootOnSelect,
            firstRunCelebrated: firstRunCelebrated,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String projectRoot,
            Value<String?> vmServiceUrl = const Value.absent(),
            Value<String?> defaultAgentId = const Value.absent(),
            Value<String?> lastChatId = const Value.absent(),
            Value<String?> paneSizes = const Value.absent(),
            Value<DateTime?> lastUsedAt = const Value.absent(),
            Value<String?> avdId = const Value.absent(),
            Value<String?> avdName = const Value.absent(),
            Value<String> connectionMode = const Value.absent(),
            Value<String?> flutterRunArgs = const Value.absent(),
            Value<String?> targetFile = const Value.absent(),
            Value<bool> autoBootOnSelect = const Value.absent(),
            Value<bool> firstRunCelebrated = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ProjectSettingsCompanion.insert(
            projectRoot: projectRoot,
            vmServiceUrl: vmServiceUrl,
            defaultAgentId: defaultAgentId,
            lastChatId: lastChatId,
            paneSizes: paneSizes,
            lastUsedAt: lastUsedAt,
            avdId: avdId,
            avdName: avdName,
            connectionMode: connectionMode,
            flutterRunArgs: flutterRunArgs,
            targetFile: targetFile,
            autoBootOnSelect: autoBootOnSelect,
            firstRunCelebrated: firstRunCelebrated,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$ProjectSettingsTableProcessedTableManager = ProcessedTableManager<
    _$PickforgeDatabase,
    $ProjectSettingsTable,
    ProjectSettingsRow,
    $$ProjectSettingsTableFilterComposer,
    $$ProjectSettingsTableOrderingComposer,
    $$ProjectSettingsTableAnnotationComposer,
    $$ProjectSettingsTableCreateCompanionBuilder,
    $$ProjectSettingsTableUpdateCompanionBuilder,
    (
      ProjectSettingsRow,
      BaseReferences<_$PickforgeDatabase, $ProjectSettingsTable,
          ProjectSettingsRow>
    ),
    ProjectSettingsRow,
    PrefetchHooks Function()>;
typedef $$PickHistoryTableCreateCompanionBuilder = PickHistoryCompanion
    Function({
  Value<int> id,
  required String projectRoot,
  required String widgetClass,
  Value<String?> creationFile,
  Value<int?> creationLine,
  required String skillId,
  required String agentId,
  required String terminalId,
  Value<String?> chatId,
  required DateTime pickedAt,
  required String widgetContextJson,
});
typedef $$PickHistoryTableUpdateCompanionBuilder = PickHistoryCompanion
    Function({
  Value<int> id,
  Value<String> projectRoot,
  Value<String> widgetClass,
  Value<String?> creationFile,
  Value<int?> creationLine,
  Value<String> skillId,
  Value<String> agentId,
  Value<String> terminalId,
  Value<String?> chatId,
  Value<DateTime> pickedAt,
  Value<String> widgetContextJson,
});

class $$PickHistoryTableFilterComposer
    extends Composer<_$PickforgeDatabase, $PickHistoryTable> {
  $$PickHistoryTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get widgetClass => $composableBuilder(
      column: $table.widgetClass, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get creationFile => $composableBuilder(
      column: $table.creationFile, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get creationLine => $composableBuilder(
      column: $table.creationLine, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get skillId => $composableBuilder(
      column: $table.skillId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get terminalId => $composableBuilder(
      column: $table.terminalId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get chatId => $composableBuilder(
      column: $table.chatId, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get pickedAt => $composableBuilder(
      column: $table.pickedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get widgetContextJson => $composableBuilder(
      column: $table.widgetContextJson,
      builder: (column) => ColumnFilters(column));
}

class $$PickHistoryTableOrderingComposer
    extends Composer<_$PickforgeDatabase, $PickHistoryTable> {
  $$PickHistoryTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get widgetClass => $composableBuilder(
      column: $table.widgetClass, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get creationFile => $composableBuilder(
      column: $table.creationFile,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get creationLine => $composableBuilder(
      column: $table.creationLine,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get skillId => $composableBuilder(
      column: $table.skillId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get terminalId => $composableBuilder(
      column: $table.terminalId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get chatId => $composableBuilder(
      column: $table.chatId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get pickedAt => $composableBuilder(
      column: $table.pickedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get widgetContextJson => $composableBuilder(
      column: $table.widgetContextJson,
      builder: (column) => ColumnOrderings(column));
}

class $$PickHistoryTableAnnotationComposer
    extends Composer<_$PickforgeDatabase, $PickHistoryTable> {
  $$PickHistoryTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => column);

  GeneratedColumn<String> get widgetClass => $composableBuilder(
      column: $table.widgetClass, builder: (column) => column);

  GeneratedColumn<String> get creationFile => $composableBuilder(
      column: $table.creationFile, builder: (column) => column);

  GeneratedColumn<int> get creationLine => $composableBuilder(
      column: $table.creationLine, builder: (column) => column);

  GeneratedColumn<String> get skillId =>
      $composableBuilder(column: $table.skillId, builder: (column) => column);

  GeneratedColumn<String> get agentId =>
      $composableBuilder(column: $table.agentId, builder: (column) => column);

  GeneratedColumn<String> get terminalId => $composableBuilder(
      column: $table.terminalId, builder: (column) => column);

  GeneratedColumn<String> get chatId =>
      $composableBuilder(column: $table.chatId, builder: (column) => column);

  GeneratedColumn<DateTime> get pickedAt =>
      $composableBuilder(column: $table.pickedAt, builder: (column) => column);

  GeneratedColumn<String> get widgetContextJson => $composableBuilder(
      column: $table.widgetContextJson, builder: (column) => column);
}

class $$PickHistoryTableTableManager extends RootTableManager<
    _$PickforgeDatabase,
    $PickHistoryTable,
    PickHistoryRow,
    $$PickHistoryTableFilterComposer,
    $$PickHistoryTableOrderingComposer,
    $$PickHistoryTableAnnotationComposer,
    $$PickHistoryTableCreateCompanionBuilder,
    $$PickHistoryTableUpdateCompanionBuilder,
    (
      PickHistoryRow,
      BaseReferences<_$PickforgeDatabase, $PickHistoryTable, PickHistoryRow>
    ),
    PickHistoryRow,
    PrefetchHooks Function()> {
  $$PickHistoryTableTableManager(
      _$PickforgeDatabase db, $PickHistoryTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PickHistoryTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PickHistoryTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PickHistoryTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<String> projectRoot = const Value.absent(),
            Value<String> widgetClass = const Value.absent(),
            Value<String?> creationFile = const Value.absent(),
            Value<int?> creationLine = const Value.absent(),
            Value<String> skillId = const Value.absent(),
            Value<String> agentId = const Value.absent(),
            Value<String> terminalId = const Value.absent(),
            Value<String?> chatId = const Value.absent(),
            Value<DateTime> pickedAt = const Value.absent(),
            Value<String> widgetContextJson = const Value.absent(),
          }) =>
              PickHistoryCompanion(
            id: id,
            projectRoot: projectRoot,
            widgetClass: widgetClass,
            creationFile: creationFile,
            creationLine: creationLine,
            skillId: skillId,
            agentId: agentId,
            terminalId: terminalId,
            chatId: chatId,
            pickedAt: pickedAt,
            widgetContextJson: widgetContextJson,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required String projectRoot,
            required String widgetClass,
            Value<String?> creationFile = const Value.absent(),
            Value<int?> creationLine = const Value.absent(),
            required String skillId,
            required String agentId,
            required String terminalId,
            Value<String?> chatId = const Value.absent(),
            required DateTime pickedAt,
            required String widgetContextJson,
          }) =>
              PickHistoryCompanion.insert(
            id: id,
            projectRoot: projectRoot,
            widgetClass: widgetClass,
            creationFile: creationFile,
            creationLine: creationLine,
            skillId: skillId,
            agentId: agentId,
            terminalId: terminalId,
            chatId: chatId,
            pickedAt: pickedAt,
            widgetContextJson: widgetContextJson,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$PickHistoryTableProcessedTableManager = ProcessedTableManager<
    _$PickforgeDatabase,
    $PickHistoryTable,
    PickHistoryRow,
    $$PickHistoryTableFilterComposer,
    $$PickHistoryTableOrderingComposer,
    $$PickHistoryTableAnnotationComposer,
    $$PickHistoryTableCreateCompanionBuilder,
    $$PickHistoryTableUpdateCompanionBuilder,
    (
      PickHistoryRow,
      BaseReferences<_$PickforgeDatabase, $PickHistoryTable, PickHistoryRow>
    ),
    PickHistoryRow,
    PrefetchHooks Function()>;
typedef $$AgentRunLogTableCreateCompanionBuilder = AgentRunLogCompanion
    Function({
  Value<int> id,
  required int pickId,
  required DateTime startedAt,
  Value<DateTime?> finishedAt,
  Value<int?> exitCode,
  Value<int> hotReloadCount,
  required String wrapperScriptPath,
});
typedef $$AgentRunLogTableUpdateCompanionBuilder = AgentRunLogCompanion
    Function({
  Value<int> id,
  Value<int> pickId,
  Value<DateTime> startedAt,
  Value<DateTime?> finishedAt,
  Value<int?> exitCode,
  Value<int> hotReloadCount,
  Value<String> wrapperScriptPath,
});

class $$AgentRunLogTableFilterComposer
    extends Composer<_$PickforgeDatabase, $AgentRunLogTable> {
  $$AgentRunLogTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get pickId => $composableBuilder(
      column: $table.pickId, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get startedAt => $composableBuilder(
      column: $table.startedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get finishedAt => $composableBuilder(
      column: $table.finishedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get exitCode => $composableBuilder(
      column: $table.exitCode, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get hotReloadCount => $composableBuilder(
      column: $table.hotReloadCount,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get wrapperScriptPath => $composableBuilder(
      column: $table.wrapperScriptPath,
      builder: (column) => ColumnFilters(column));
}

class $$AgentRunLogTableOrderingComposer
    extends Composer<_$PickforgeDatabase, $AgentRunLogTable> {
  $$AgentRunLogTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get pickId => $composableBuilder(
      column: $table.pickId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get startedAt => $composableBuilder(
      column: $table.startedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get finishedAt => $composableBuilder(
      column: $table.finishedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get exitCode => $composableBuilder(
      column: $table.exitCode, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get hotReloadCount => $composableBuilder(
      column: $table.hotReloadCount,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get wrapperScriptPath => $composableBuilder(
      column: $table.wrapperScriptPath,
      builder: (column) => ColumnOrderings(column));
}

class $$AgentRunLogTableAnnotationComposer
    extends Composer<_$PickforgeDatabase, $AgentRunLogTable> {
  $$AgentRunLogTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<int> get pickId =>
      $composableBuilder(column: $table.pickId, builder: (column) => column);

  GeneratedColumn<DateTime> get startedAt =>
      $composableBuilder(column: $table.startedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get finishedAt => $composableBuilder(
      column: $table.finishedAt, builder: (column) => column);

  GeneratedColumn<int> get exitCode =>
      $composableBuilder(column: $table.exitCode, builder: (column) => column);

  GeneratedColumn<int> get hotReloadCount => $composableBuilder(
      column: $table.hotReloadCount, builder: (column) => column);

  GeneratedColumn<String> get wrapperScriptPath => $composableBuilder(
      column: $table.wrapperScriptPath, builder: (column) => column);
}

class $$AgentRunLogTableTableManager extends RootTableManager<
    _$PickforgeDatabase,
    $AgentRunLogTable,
    AgentRunLogRow,
    $$AgentRunLogTableFilterComposer,
    $$AgentRunLogTableOrderingComposer,
    $$AgentRunLogTableAnnotationComposer,
    $$AgentRunLogTableCreateCompanionBuilder,
    $$AgentRunLogTableUpdateCompanionBuilder,
    (
      AgentRunLogRow,
      BaseReferences<_$PickforgeDatabase, $AgentRunLogTable, AgentRunLogRow>
    ),
    AgentRunLogRow,
    PrefetchHooks Function()> {
  $$AgentRunLogTableTableManager(
      _$PickforgeDatabase db, $AgentRunLogTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$AgentRunLogTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$AgentRunLogTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$AgentRunLogTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<int> id = const Value.absent(),
            Value<int> pickId = const Value.absent(),
            Value<DateTime> startedAt = const Value.absent(),
            Value<DateTime?> finishedAt = const Value.absent(),
            Value<int?> exitCode = const Value.absent(),
            Value<int> hotReloadCount = const Value.absent(),
            Value<String> wrapperScriptPath = const Value.absent(),
          }) =>
              AgentRunLogCompanion(
            id: id,
            pickId: pickId,
            startedAt: startedAt,
            finishedAt: finishedAt,
            exitCode: exitCode,
            hotReloadCount: hotReloadCount,
            wrapperScriptPath: wrapperScriptPath,
          ),
          createCompanionCallback: ({
            Value<int> id = const Value.absent(),
            required int pickId,
            required DateTime startedAt,
            Value<DateTime?> finishedAt = const Value.absent(),
            Value<int?> exitCode = const Value.absent(),
            Value<int> hotReloadCount = const Value.absent(),
            required String wrapperScriptPath,
          }) =>
              AgentRunLogCompanion.insert(
            id: id,
            pickId: pickId,
            startedAt: startedAt,
            finishedAt: finishedAt,
            exitCode: exitCode,
            hotReloadCount: hotReloadCount,
            wrapperScriptPath: wrapperScriptPath,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$AgentRunLogTableProcessedTableManager = ProcessedTableManager<
    _$PickforgeDatabase,
    $AgentRunLogTable,
    AgentRunLogRow,
    $$AgentRunLogTableFilterComposer,
    $$AgentRunLogTableOrderingComposer,
    $$AgentRunLogTableAnnotationComposer,
    $$AgentRunLogTableCreateCompanionBuilder,
    $$AgentRunLogTableUpdateCompanionBuilder,
    (
      AgentRunLogRow,
      BaseReferences<_$PickforgeDatabase, $AgentRunLogTable, AgentRunLogRow>
    ),
    AgentRunLogRow,
    PrefetchHooks Function()>;
typedef $$ProjectsTableCreateCompanionBuilder = ProjectsCompanion Function({
  required String projectRoot,
  required String displayName,
  required DateTime createdAt,
  required DateTime lastOpenedAt,
  Value<int> sortOrder,
  Value<int> rowid,
});
typedef $$ProjectsTableUpdateCompanionBuilder = ProjectsCompanion Function({
  Value<String> projectRoot,
  Value<String> displayName,
  Value<DateTime> createdAt,
  Value<DateTime> lastOpenedAt,
  Value<int> sortOrder,
  Value<int> rowid,
});

final class $$ProjectsTableReferences
    extends BaseReferences<_$PickforgeDatabase, $ProjectsTable, ProjectRow> {
  $$ProjectsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static MultiTypedResultKey<$ChatsTable, List<ChatRow>> _chatsRefsTable(
          _$PickforgeDatabase db) =>
      MultiTypedResultKey.fromTable(db.chats,
          aliasName: $_aliasNameGenerator(
              db.projects.projectRoot, db.chats.projectRoot));

  $$ChatsTableProcessedTableManager get chatsRefs {
    final manager = $$ChatsTableTableManager($_db, $_db.chats).filter((f) => f
        .projectRoot.projectRoot
        .sqlEquals($_itemColumn<String>('project_root')!));

    final cache = $_typedResult.readTableOrNull(_chatsRefsTable($_db));
    return ProcessedTableManager(
        manager.$state.copyWith(prefetchedData: cache));
  }
}

class $$ProjectsTableFilterComposer
    extends Composer<_$PickforgeDatabase, $ProjectsTable> {
  $$ProjectsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastOpenedAt => $composableBuilder(
      column: $table.lastOpenedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get sortOrder => $composableBuilder(
      column: $table.sortOrder, builder: (column) => ColumnFilters(column));

  Expression<bool> chatsRefs(
      Expression<bool> Function($$ChatsTableFilterComposer f) f) {
    final $$ChatsTableFilterComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.projectRoot,
        referencedTable: $db.chats,
        getReferencedColumn: (t) => t.projectRoot,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$ChatsTableFilterComposer(
              $db: $db,
              $table: $db.chats,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return f(composer);
  }
}

class $$ProjectsTableOrderingComposer
    extends Composer<_$PickforgeDatabase, $ProjectsTable> {
  $$ProjectsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastOpenedAt => $composableBuilder(
      column: $table.lastOpenedAt,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get sortOrder => $composableBuilder(
      column: $table.sortOrder, builder: (column) => ColumnOrderings(column));
}

class $$ProjectsTableAnnotationComposer
    extends Composer<_$PickforgeDatabase, $ProjectsTable> {
  $$ProjectsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => column);

  GeneratedColumn<String> get displayName => $composableBuilder(
      column: $table.displayName, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get lastOpenedAt => $composableBuilder(
      column: $table.lastOpenedAt, builder: (column) => column);

  GeneratedColumn<int> get sortOrder =>
      $composableBuilder(column: $table.sortOrder, builder: (column) => column);

  Expression<T> chatsRefs<T extends Object>(
      Expression<T> Function($$ChatsTableAnnotationComposer a) f) {
    final $$ChatsTableAnnotationComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.projectRoot,
        referencedTable: $db.chats,
        getReferencedColumn: (t) => t.projectRoot,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$ChatsTableAnnotationComposer(
              $db: $db,
              $table: $db.chats,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return f(composer);
  }
}

class $$ProjectsTableTableManager extends RootTableManager<
    _$PickforgeDatabase,
    $ProjectsTable,
    ProjectRow,
    $$ProjectsTableFilterComposer,
    $$ProjectsTableOrderingComposer,
    $$ProjectsTableAnnotationComposer,
    $$ProjectsTableCreateCompanionBuilder,
    $$ProjectsTableUpdateCompanionBuilder,
    (ProjectRow, $$ProjectsTableReferences),
    ProjectRow,
    PrefetchHooks Function({bool chatsRefs})> {
  $$ProjectsTableTableManager(_$PickforgeDatabase db, $ProjectsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ProjectsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ProjectsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ProjectsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> projectRoot = const Value.absent(),
            Value<String> displayName = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<DateTime> lastOpenedAt = const Value.absent(),
            Value<int> sortOrder = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ProjectsCompanion(
            projectRoot: projectRoot,
            displayName: displayName,
            createdAt: createdAt,
            lastOpenedAt: lastOpenedAt,
            sortOrder: sortOrder,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String projectRoot,
            required String displayName,
            required DateTime createdAt,
            required DateTime lastOpenedAt,
            Value<int> sortOrder = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ProjectsCompanion.insert(
            projectRoot: projectRoot,
            displayName: displayName,
            createdAt: createdAt,
            lastOpenedAt: lastOpenedAt,
            sortOrder: sortOrder,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) =>
                  (e.readTable(table), $$ProjectsTableReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: ({chatsRefs = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [if (chatsRefs) db.chats],
              addJoins: null,
              getPrefetchedDataCallback: (items) async {
                return [
                  if (chatsRefs)
                    await $_getPrefetchedData<ProjectRow, $ProjectsTable,
                            ChatRow>(
                        currentTable: table,
                        referencedTable:
                            $$ProjectsTableReferences._chatsRefsTable(db),
                        managerFromTypedResult: (p0) =>
                            $$ProjectsTableReferences(db, table, p0).chatsRefs,
                        referencedItemsForCurrentItem:
                            (item, referencedItems) => referencedItems.where(
                                (e) => e.projectRoot == item.projectRoot),
                        typedResults: items)
                ];
              },
            );
          },
        ));
}

typedef $$ProjectsTableProcessedTableManager = ProcessedTableManager<
    _$PickforgeDatabase,
    $ProjectsTable,
    ProjectRow,
    $$ProjectsTableFilterComposer,
    $$ProjectsTableOrderingComposer,
    $$ProjectsTableAnnotationComposer,
    $$ProjectsTableCreateCompanionBuilder,
    $$ProjectsTableUpdateCompanionBuilder,
    (ProjectRow, $$ProjectsTableReferences),
    ProjectRow,
    PrefetchHooks Function({bool chatsRefs})>;
typedef $$ChatsTableCreateCompanionBuilder = ChatsCompanion Function({
  required String chatId,
  required String projectRoot,
  required String title,
  required String agentId,
  Value<String?> skillId,
  Value<String?> sessionId,
  required DateTime createdAt,
  required DateTime lastActivityAt,
  Value<int> sortOrder,
  Value<int> rowid,
});
typedef $$ChatsTableUpdateCompanionBuilder = ChatsCompanion Function({
  Value<String> chatId,
  Value<String> projectRoot,
  Value<String> title,
  Value<String> agentId,
  Value<String?> skillId,
  Value<String?> sessionId,
  Value<DateTime> createdAt,
  Value<DateTime> lastActivityAt,
  Value<int> sortOrder,
  Value<int> rowid,
});

final class $$ChatsTableReferences
    extends BaseReferences<_$PickforgeDatabase, $ChatsTable, ChatRow> {
  $$ChatsTableReferences(super.$_db, super.$_table, super.$_typedResult);

  static $ProjectsTable _projectRootTable(_$PickforgeDatabase db) =>
      db.projects.createAlias(
          $_aliasNameGenerator(db.chats.projectRoot, db.projects.projectRoot));

  $$ProjectsTableProcessedTableManager get projectRoot {
    final $_column = $_itemColumn<String>('project_root')!;

    final manager = $$ProjectsTableTableManager($_db, $_db.projects)
        .filter((f) => f.projectRoot.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_projectRootTable($_db));
    if (item == null) return manager;
    return ProcessedTableManager(
        manager.$state.copyWith(prefetchedData: [item]));
  }
}

class $$ChatsTableFilterComposer
    extends Composer<_$PickforgeDatabase, $ChatsTable> {
  $$ChatsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get chatId => $composableBuilder(
      column: $table.chatId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get skillId => $composableBuilder(
      column: $table.skillId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get sessionId => $composableBuilder(
      column: $table.sessionId, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get lastActivityAt => $composableBuilder(
      column: $table.lastActivityAt,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get sortOrder => $composableBuilder(
      column: $table.sortOrder, builder: (column) => ColumnFilters(column));

  $$ProjectsTableFilterComposer get projectRoot {
    final $$ProjectsTableFilterComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.projectRoot,
        referencedTable: $db.projects,
        getReferencedColumn: (t) => t.projectRoot,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$ProjectsTableFilterComposer(
              $db: $db,
              $table: $db.projects,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$ChatsTableOrderingComposer
    extends Composer<_$PickforgeDatabase, $ChatsTable> {
  $$ChatsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get chatId => $composableBuilder(
      column: $table.chatId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get title => $composableBuilder(
      column: $table.title, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get agentId => $composableBuilder(
      column: $table.agentId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get skillId => $composableBuilder(
      column: $table.skillId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get sessionId => $composableBuilder(
      column: $table.sessionId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get lastActivityAt => $composableBuilder(
      column: $table.lastActivityAt,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get sortOrder => $composableBuilder(
      column: $table.sortOrder, builder: (column) => ColumnOrderings(column));

  $$ProjectsTableOrderingComposer get projectRoot {
    final $$ProjectsTableOrderingComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.projectRoot,
        referencedTable: $db.projects,
        getReferencedColumn: (t) => t.projectRoot,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$ProjectsTableOrderingComposer(
              $db: $db,
              $table: $db.projects,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$ChatsTableAnnotationComposer
    extends Composer<_$PickforgeDatabase, $ChatsTable> {
  $$ChatsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get chatId =>
      $composableBuilder(column: $table.chatId, builder: (column) => column);

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<String> get agentId =>
      $composableBuilder(column: $table.agentId, builder: (column) => column);

  GeneratedColumn<String> get skillId =>
      $composableBuilder(column: $table.skillId, builder: (column) => column);

  GeneratedColumn<String> get sessionId =>
      $composableBuilder(column: $table.sessionId, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get lastActivityAt => $composableBuilder(
      column: $table.lastActivityAt, builder: (column) => column);

  GeneratedColumn<int> get sortOrder =>
      $composableBuilder(column: $table.sortOrder, builder: (column) => column);

  $$ProjectsTableAnnotationComposer get projectRoot {
    final $$ProjectsTableAnnotationComposer composer = $composerBuilder(
        composer: this,
        getCurrentColumn: (t) => t.projectRoot,
        referencedTable: $db.projects,
        getReferencedColumn: (t) => t.projectRoot,
        builder: (joinBuilder,
                {$addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer}) =>
            $$ProjectsTableAnnotationComposer(
              $db: $db,
              $table: $db.projects,
              $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
              joinBuilder: joinBuilder,
              $removeJoinBuilderFromRootComposer:
                  $removeJoinBuilderFromRootComposer,
            ));
    return composer;
  }
}

class $$ChatsTableTableManager extends RootTableManager<
    _$PickforgeDatabase,
    $ChatsTable,
    ChatRow,
    $$ChatsTableFilterComposer,
    $$ChatsTableOrderingComposer,
    $$ChatsTableAnnotationComposer,
    $$ChatsTableCreateCompanionBuilder,
    $$ChatsTableUpdateCompanionBuilder,
    (ChatRow, $$ChatsTableReferences),
    ChatRow,
    PrefetchHooks Function({bool projectRoot})> {
  $$ChatsTableTableManager(_$PickforgeDatabase db, $ChatsTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$ChatsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$ChatsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$ChatsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> chatId = const Value.absent(),
            Value<String> projectRoot = const Value.absent(),
            Value<String> title = const Value.absent(),
            Value<String> agentId = const Value.absent(),
            Value<String?> skillId = const Value.absent(),
            Value<String?> sessionId = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<DateTime> lastActivityAt = const Value.absent(),
            Value<int> sortOrder = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ChatsCompanion(
            chatId: chatId,
            projectRoot: projectRoot,
            title: title,
            agentId: agentId,
            skillId: skillId,
            sessionId: sessionId,
            createdAt: createdAt,
            lastActivityAt: lastActivityAt,
            sortOrder: sortOrder,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String chatId,
            required String projectRoot,
            required String title,
            required String agentId,
            Value<String?> skillId = const Value.absent(),
            Value<String?> sessionId = const Value.absent(),
            required DateTime createdAt,
            required DateTime lastActivityAt,
            Value<int> sortOrder = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              ChatsCompanion.insert(
            chatId: chatId,
            projectRoot: projectRoot,
            title: title,
            agentId: agentId,
            skillId: skillId,
            sessionId: sessionId,
            createdAt: createdAt,
            lastActivityAt: lastActivityAt,
            sortOrder: sortOrder,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) =>
                  (e.readTable(table), $$ChatsTableReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: ({projectRoot = false}) {
            return PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins: <
                  T extends TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic>>(state) {
                if (projectRoot) {
                  state = state.withJoin(
                    currentTable: table,
                    currentColumn: table.projectRoot,
                    referencedTable:
                        $$ChatsTableReferences._projectRootTable(db),
                    referencedColumn: $$ChatsTableReferences
                        ._projectRootTable(db)
                        .projectRoot,
                  ) as T;
                }

                return state;
              },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ));
}

typedef $$ChatsTableProcessedTableManager = ProcessedTableManager<
    _$PickforgeDatabase,
    $ChatsTable,
    ChatRow,
    $$ChatsTableFilterComposer,
    $$ChatsTableOrderingComposer,
    $$ChatsTableAnnotationComposer,
    $$ChatsTableCreateCompanionBuilder,
    $$ChatsTableUpdateCompanionBuilder,
    (ChatRow, $$ChatsTableReferences),
    ChatRow,
    PrefetchHooks Function({bool projectRoot})>;
typedef $$RunSessionLogTableCreateCompanionBuilder = RunSessionLogCompanion
    Function({
  required String sessionId,
  required String projectRoot,
  required DateTime startedAt,
  Value<DateTime?> endedAt,
  Value<String?> avdId,
  Value<String?> avdName,
  Value<String?> serial,
  Value<String?> vmServiceUrl,
  required String connectionMode,
  Value<String?> exitReason,
  Value<int?> exitCode,
  Value<int> hotReloadCount,
  Value<int> hotRestartCount,
  Value<int> errorCount,
  Value<String?> lastError,
  Value<int> rowid,
});
typedef $$RunSessionLogTableUpdateCompanionBuilder = RunSessionLogCompanion
    Function({
  Value<String> sessionId,
  Value<String> projectRoot,
  Value<DateTime> startedAt,
  Value<DateTime?> endedAt,
  Value<String?> avdId,
  Value<String?> avdName,
  Value<String?> serial,
  Value<String?> vmServiceUrl,
  Value<String> connectionMode,
  Value<String?> exitReason,
  Value<int?> exitCode,
  Value<int> hotReloadCount,
  Value<int> hotRestartCount,
  Value<int> errorCount,
  Value<String?> lastError,
  Value<int> rowid,
});

class $$RunSessionLogTableFilterComposer
    extends Composer<_$PickforgeDatabase, $RunSessionLogTable> {
  $$RunSessionLogTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get sessionId => $composableBuilder(
      column: $table.sessionId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get startedAt => $composableBuilder(
      column: $table.startedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get endedAt => $composableBuilder(
      column: $table.endedAt, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get avdId => $composableBuilder(
      column: $table.avdId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get avdName => $composableBuilder(
      column: $table.avdName, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get serial => $composableBuilder(
      column: $table.serial, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get vmServiceUrl => $composableBuilder(
      column: $table.vmServiceUrl, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get connectionMode => $composableBuilder(
      column: $table.connectionMode,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get exitReason => $composableBuilder(
      column: $table.exitReason, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get exitCode => $composableBuilder(
      column: $table.exitCode, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get hotReloadCount => $composableBuilder(
      column: $table.hotReloadCount,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get hotRestartCount => $composableBuilder(
      column: $table.hotRestartCount,
      builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get errorCount => $composableBuilder(
      column: $table.errorCount, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnFilters(column));
}

class $$RunSessionLogTableOrderingComposer
    extends Composer<_$PickforgeDatabase, $RunSessionLogTable> {
  $$RunSessionLogTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get sessionId => $composableBuilder(
      column: $table.sessionId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get startedAt => $composableBuilder(
      column: $table.startedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get endedAt => $composableBuilder(
      column: $table.endedAt, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get avdId => $composableBuilder(
      column: $table.avdId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get avdName => $composableBuilder(
      column: $table.avdName, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get serial => $composableBuilder(
      column: $table.serial, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get vmServiceUrl => $composableBuilder(
      column: $table.vmServiceUrl,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get connectionMode => $composableBuilder(
      column: $table.connectionMode,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get exitReason => $composableBuilder(
      column: $table.exitReason, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get exitCode => $composableBuilder(
      column: $table.exitCode, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get hotReloadCount => $composableBuilder(
      column: $table.hotReloadCount,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get hotRestartCount => $composableBuilder(
      column: $table.hotRestartCount,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get errorCount => $composableBuilder(
      column: $table.errorCount, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get lastError => $composableBuilder(
      column: $table.lastError, builder: (column) => ColumnOrderings(column));
}

class $$RunSessionLogTableAnnotationComposer
    extends Composer<_$PickforgeDatabase, $RunSessionLogTable> {
  $$RunSessionLogTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get sessionId =>
      $composableBuilder(column: $table.sessionId, builder: (column) => column);

  GeneratedColumn<String> get projectRoot => $composableBuilder(
      column: $table.projectRoot, builder: (column) => column);

  GeneratedColumn<DateTime> get startedAt =>
      $composableBuilder(column: $table.startedAt, builder: (column) => column);

  GeneratedColumn<DateTime> get endedAt =>
      $composableBuilder(column: $table.endedAt, builder: (column) => column);

  GeneratedColumn<String> get avdId =>
      $composableBuilder(column: $table.avdId, builder: (column) => column);

  GeneratedColumn<String> get avdName =>
      $composableBuilder(column: $table.avdName, builder: (column) => column);

  GeneratedColumn<String> get serial =>
      $composableBuilder(column: $table.serial, builder: (column) => column);

  GeneratedColumn<String> get vmServiceUrl => $composableBuilder(
      column: $table.vmServiceUrl, builder: (column) => column);

  GeneratedColumn<String> get connectionMode => $composableBuilder(
      column: $table.connectionMode, builder: (column) => column);

  GeneratedColumn<String> get exitReason => $composableBuilder(
      column: $table.exitReason, builder: (column) => column);

  GeneratedColumn<int> get exitCode =>
      $composableBuilder(column: $table.exitCode, builder: (column) => column);

  GeneratedColumn<int> get hotReloadCount => $composableBuilder(
      column: $table.hotReloadCount, builder: (column) => column);

  GeneratedColumn<int> get hotRestartCount => $composableBuilder(
      column: $table.hotRestartCount, builder: (column) => column);

  GeneratedColumn<int> get errorCount => $composableBuilder(
      column: $table.errorCount, builder: (column) => column);

  GeneratedColumn<String> get lastError =>
      $composableBuilder(column: $table.lastError, builder: (column) => column);
}

class $$RunSessionLogTableTableManager extends RootTableManager<
    _$PickforgeDatabase,
    $RunSessionLogTable,
    RunSessionLogRow,
    $$RunSessionLogTableFilterComposer,
    $$RunSessionLogTableOrderingComposer,
    $$RunSessionLogTableAnnotationComposer,
    $$RunSessionLogTableCreateCompanionBuilder,
    $$RunSessionLogTableUpdateCompanionBuilder,
    (
      RunSessionLogRow,
      BaseReferences<_$PickforgeDatabase, $RunSessionLogTable, RunSessionLogRow>
    ),
    RunSessionLogRow,
    PrefetchHooks Function()> {
  $$RunSessionLogTableTableManager(
      _$PickforgeDatabase db, $RunSessionLogTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$RunSessionLogTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$RunSessionLogTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$RunSessionLogTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> sessionId = const Value.absent(),
            Value<String> projectRoot = const Value.absent(),
            Value<DateTime> startedAt = const Value.absent(),
            Value<DateTime?> endedAt = const Value.absent(),
            Value<String?> avdId = const Value.absent(),
            Value<String?> avdName = const Value.absent(),
            Value<String?> serial = const Value.absent(),
            Value<String?> vmServiceUrl = const Value.absent(),
            Value<String> connectionMode = const Value.absent(),
            Value<String?> exitReason = const Value.absent(),
            Value<int?> exitCode = const Value.absent(),
            Value<int> hotReloadCount = const Value.absent(),
            Value<int> hotRestartCount = const Value.absent(),
            Value<int> errorCount = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              RunSessionLogCompanion(
            sessionId: sessionId,
            projectRoot: projectRoot,
            startedAt: startedAt,
            endedAt: endedAt,
            avdId: avdId,
            avdName: avdName,
            serial: serial,
            vmServiceUrl: vmServiceUrl,
            connectionMode: connectionMode,
            exitReason: exitReason,
            exitCode: exitCode,
            hotReloadCount: hotReloadCount,
            hotRestartCount: hotRestartCount,
            errorCount: errorCount,
            lastError: lastError,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String sessionId,
            required String projectRoot,
            required DateTime startedAt,
            Value<DateTime?> endedAt = const Value.absent(),
            Value<String?> avdId = const Value.absent(),
            Value<String?> avdName = const Value.absent(),
            Value<String?> serial = const Value.absent(),
            Value<String?> vmServiceUrl = const Value.absent(),
            required String connectionMode,
            Value<String?> exitReason = const Value.absent(),
            Value<int?> exitCode = const Value.absent(),
            Value<int> hotReloadCount = const Value.absent(),
            Value<int> hotRestartCount = const Value.absent(),
            Value<int> errorCount = const Value.absent(),
            Value<String?> lastError = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              RunSessionLogCompanion.insert(
            sessionId: sessionId,
            projectRoot: projectRoot,
            startedAt: startedAt,
            endedAt: endedAt,
            avdId: avdId,
            avdName: avdName,
            serial: serial,
            vmServiceUrl: vmServiceUrl,
            connectionMode: connectionMode,
            exitReason: exitReason,
            exitCode: exitCode,
            hotReloadCount: hotReloadCount,
            hotRestartCount: hotRestartCount,
            errorCount: errorCount,
            lastError: lastError,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$RunSessionLogTableProcessedTableManager = ProcessedTableManager<
    _$PickforgeDatabase,
    $RunSessionLogTable,
    RunSessionLogRow,
    $$RunSessionLogTableFilterComposer,
    $$RunSessionLogTableOrderingComposer,
    $$RunSessionLogTableAnnotationComposer,
    $$RunSessionLogTableCreateCompanionBuilder,
    $$RunSessionLogTableUpdateCompanionBuilder,
    (
      RunSessionLogRow,
      BaseReferences<_$PickforgeDatabase, $RunSessionLogTable, RunSessionLogRow>
    ),
    RunSessionLogRow,
    PrefetchHooks Function()>;

class $PickforgeDatabaseManager {
  final _$PickforgeDatabase _db;
  $PickforgeDatabaseManager(this._db);
  $$ProjectSettingsTableTableManager get projectSettings =>
      $$ProjectSettingsTableTableManager(_db, _db.projectSettings);
  $$PickHistoryTableTableManager get pickHistory =>
      $$PickHistoryTableTableManager(_db, _db.pickHistory);
  $$AgentRunLogTableTableManager get agentRunLog =>
      $$AgentRunLogTableTableManager(_db, _db.agentRunLog);
  $$ProjectsTableTableManager get projects =>
      $$ProjectsTableTableManager(_db, _db.projects);
  $$ChatsTableTableManager get chats =>
      $$ChatsTableTableManager(_db, _db.chats);
  $$RunSessionLogTableTableManager get runSessionLog =>
      $$RunSessionLogTableTableManager(_db, _db.runSessionLog);
}
