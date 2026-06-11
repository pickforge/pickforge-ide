import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// How much the run log records. Normal covers app events and errors;
/// verbose adds fine-grained tracing for users reproducing a bug.
enum LogVerbosity { normal, verbose }

@lazySingleton
class LogSettingsRepository {
  LogSettingsRepository(this._prefs);

  final SharedPreferences _prefs;

  static const _verbosityKey = 'logging.verbosity';

  Future<LogVerbosity> load() async {
    return LogVerbosity.values.firstWhere(
      (v) => v.name == _prefs.getString(_verbosityKey),
      orElse: () => LogVerbosity.normal,
    );
  }

  Future<void> save(LogVerbosity verbosity) async {
    await _prefs.setString(_verbosityKey, verbosity.name);
  }
}
