import 'package:equatable/equatable.dart';
import 'package:shared_preferences/shared_preferences.dart';

class NotificationSettings extends Equatable {
  const NotificationSettings({required this.chatReadySoundEnabled});

  static const defaults = NotificationSettings(chatReadySoundEnabled: true);

  /// Play the forge bell when a background chat finishes and needs attention.
  final bool chatReadySoundEnabled;

  @override
  List<Object?> get props => [chatReadySoundEnabled];
}

class NotificationSettingsRepository {
  NotificationSettingsRepository(this._prefs);

  static const _chatReadySoundKey = 'notifications.chatReadySound';

  final SharedPreferences _prefs;

  Future<NotificationSettings> load() async {
    return NotificationSettings(
      chatReadySoundEnabled: _prefs.getBool(_chatReadySoundKey) ??
          NotificationSettings.defaults.chatReadySoundEnabled,
    );
  }

  Future<void> setChatReadySoundEnabled({required bool enabled}) async {
    await _prefs.setBool(_chatReadySoundKey, enabled);
  }
}
