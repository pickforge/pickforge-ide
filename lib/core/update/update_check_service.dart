import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _defaultUpdateMetadataUrl = String.fromEnvironment(
  'PICKFORGE_UPDATE_METADATA_URL',
);
const _defaultCurrentVersion = String.fromEnvironment(
  'PICKFORGE_VERSION',
  defaultValue: '0.1.0+1',
);

typedef UpdateMetadataFetcher = Future<Object?> Function(Uri uri);

class UpdateCheckSettings extends Equatable {
  const UpdateCheckSettings({required this.enabled});

  static const defaults = UpdateCheckSettings(enabled: true);

  final bool enabled;

  UpdateCheckSettings copyWith({bool? enabled}) {
    return UpdateCheckSettings(enabled: enabled ?? this.enabled);
  }

  @override
  List<Object?> get props => [enabled];
}

class UpdateCheckSettingsRepository {
  UpdateCheckSettingsRepository(this._prefs);

  static const _enabledKey = 'updates.check.enabled';

  final SharedPreferences _prefs;

  Future<UpdateCheckSettings> load() async {
    return UpdateCheckSettings(
      enabled:
          _prefs.getBool(_enabledKey) ?? UpdateCheckSettings.defaults.enabled,
    );
  }

  Future<void> save(UpdateCheckSettings settings) async {
    await _prefs.setBool(_enabledKey, settings.enabled);
  }

  Future<void> setEnabled({required bool enabled}) async {
    await save(UpdateCheckSettings(enabled: enabled));
  }
}

enum UpdateCheckStatus {
  disabled,
  notConfigured,
  upToDate,
  updateAvailable,
  failed,
}

class UpdateCheckResult extends Equatable {
  const UpdateCheckResult({
    required this.status,
    required this.currentVersion,
    required this.checkedAt,
    this.latestVersion,
    this.downloadUrl,
    this.releaseNotesUrl,
    this.message,
  });

  final UpdateCheckStatus status;
  final String currentVersion;
  final DateTime checkedAt;
  final String? latestVersion;
  final String? downloadUrl;
  final String? releaseNotesUrl;
  final String? message;

  bool get hasUpdate => status == UpdateCheckStatus.updateAvailable;

  @override
  List<Object?> get props => [
        status,
        currentVersion,
        checkedAt,
        latestVersion,
        downloadUrl,
        releaseNotesUrl,
        message,
      ];
}

class UpdateCheckService {
  UpdateCheckService({
    required UpdateCheckSettingsRepository settings,
    Dio? dio,
    UpdateMetadataFetcher? metadataFetcher,
    String metadataUrl = _defaultUpdateMetadataUrl,
    String currentVersion = _defaultCurrentVersion,
    DateTime Function()? now,
  })  : _settings = settings,
        _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 3),
                receiveTimeout: const Duration(seconds: 3),
              ),
            ),
        _metadataUrl = metadataUrl,
        _currentVersion = currentVersion,
        _now = now ?? DateTime.now,
        _metadataFetcher = metadataFetcher;

  final UpdateCheckSettingsRepository _settings;
  final Dio _dio;
  final String _metadataUrl;
  final String _currentVersion;
  final DateTime Function() _now;
  final UpdateMetadataFetcher? _metadataFetcher;

  Future<UpdateCheckResult> check() async {
    final settings = await _settings.load();
    if (!settings.enabled) {
      return _result(UpdateCheckStatus.disabled);
    }

    final endpoint = _metadataUrl.trim();
    if (endpoint.isEmpty) {
      return _result(
        UpdateCheckStatus.notConfigured,
        message: 'No update metadata endpoint configured.',
      );
    }

    try {
      final metadata = _parseMetadata(await _fetch(Uri.parse(endpoint)));
      final latestVersion = metadata.version;
      final hasUpdate = _compareVersions(latestVersion, _currentVersion) > 0;
      return _result(
        hasUpdate
            ? UpdateCheckStatus.updateAvailable
            : UpdateCheckStatus.upToDate,
        latestVersion: latestVersion,
        downloadUrl: metadata.downloadUrl,
        releaseNotesUrl: metadata.releaseNotesUrl,
      );
    } on DioException catch (error) {
      return _result(UpdateCheckStatus.failed, message: error.message);
    } on Object catch (error) {
      return _result(UpdateCheckStatus.failed, message: error.toString());
    }
  }

  Future<void> checkInBackground() async {
    try {
      await check();
    } on Object {
      return;
    }
  }

  Future<Object?> _fetch(Uri uri) async {
    final fetcher = _metadataFetcher;
    if (fetcher != null) return fetcher(uri);
    final response = await _dio.getUri<Object?>(uri);
    return response.data;
  }

  UpdateCheckResult _result(
    UpdateCheckStatus status, {
    String? latestVersion,
    String? downloadUrl,
    String? releaseNotesUrl,
    String? message,
  }) {
    return UpdateCheckResult(
      status: status,
      currentVersion: _currentVersion,
      checkedAt: _now().toUtc(),
      latestVersion: latestVersion,
      downloadUrl: downloadUrl,
      releaseNotesUrl: releaseNotesUrl,
      message: message,
    );
  }
}

_UpdateMetadata _parseMetadata(Object? data) {
  final Object? decoded = switch (data) {
    final String value => jsonDecode(value),
    _ => data,
  };
  if (decoded is! Map) {
    throw const FormatException('Update metadata must be a JSON object.');
  }
  final map = Map<String, Object?>.from(decoded);
  final version = _stringValue(map['version']) ??
      _stringValue(map['latestVersion']) ??
      _stringValue(map['tagName']);
  if (version == null) {
    throw const FormatException('Update metadata missing version.');
  }
  return _UpdateMetadata(
    version: version,
    downloadUrl: _stringValue(map['downloadUrl']),
    releaseNotesUrl: _stringValue(map['releaseNotesUrl']),
  );
}

String? _stringValue(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

int _compareVersions(String a, String b) {
  final left = _versionParts(a);
  final right = _versionParts(b);
  final maxLength = left.length > right.length ? left.length : right.length;
  for (var index = 0; index < maxLength; index++) {
    final leftValue = index < left.length ? left[index] : 0;
    final rightValue = index < right.length ? right[index] : 0;
    if (leftValue != rightValue) return leftValue.compareTo(rightValue);
  }
  return 0;
}

List<int> _versionParts(String version) {
  final normalized = version.trim().replaceFirst(RegExp('^[vV]'), '');
  final plusParts = normalized.split('+');
  final core = plusParts.first.split('-').first;
  final parts = core.split('.').map(_leadingInt).toList();
  if (plusParts.length > 1) {
    parts.add(_leadingInt(plusParts[1]));
  }
  return parts;
}

int _leadingInt(String value) {
  final match = RegExp(r'^\d+').firstMatch(value.trim());
  return match == null ? 0 : int.parse(match.group(0)!);
}

class _UpdateMetadata {
  const _UpdateMetadata({
    required this.version,
    this.downloadUrl,
    this.releaseNotesUrl,
  });

  final String version;
  final String? downloadUrl;
  final String? releaseNotesUrl;
}
