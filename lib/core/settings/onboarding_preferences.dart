import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

@lazySingleton
class OnboardingPreferences {
  OnboardingPreferences(this._prefs);

  static const _dismissedKey = 'onboarding.dismissed';

  final SharedPreferences _prefs;

  bool get isDismissed => _prefs.getBool(_dismissedKey) ?? false;

  Future<void> setDismissed({required bool value}) async {
    await _prefs.setBool(_dismissedKey, value);
  }
}
