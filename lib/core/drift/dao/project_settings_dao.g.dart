// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'project_settings_dao.dart';

// ignore_for_file: type=lint
mixin _$ProjectSettingsDaoMixin on DatabaseAccessor<PickforgeDatabase> {
  $ProjectSettingsTable get projectSettings => attachedDatabase.projectSettings;
  ProjectSettingsDaoManager get managers => ProjectSettingsDaoManager(this);
}

class ProjectSettingsDaoManager {
  final _$ProjectSettingsDaoMixin _db;
  ProjectSettingsDaoManager(this._db);
  $$ProjectSettingsTableTableManager get projectSettings =>
      $$ProjectSettingsTableTableManager(
          _db.attachedDatabase, _db.projectSettings);
}
