import 'package:equatable/equatable.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TelemetrySettings extends Equatable {
  const TelemetrySettings({required this.enabled});

  static const defaults = TelemetrySettings(enabled: false);

  final bool enabled;

  @override
  List<Object?> get props => [enabled];
}

class TelemetrySettingsRepository {
  TelemetrySettingsRepository(this._prefs);

  static const _enabledKey = 'telemetry.enabled';

  final SharedPreferences _prefs;

  Future<TelemetrySettings> load() async {
    return TelemetrySettings(
      enabled:
          _prefs.getBool(_enabledKey) ?? TelemetrySettings.defaults.enabled,
    );
  }

  Future<void> save(TelemetrySettings settings) async {
    await _prefs.setBool(_enabledKey, settings.enabled);
  }

  Future<void> setEnabled({required bool enabled}) async {
    await save(TelemetrySettings(enabled: enabled));
  }
}
