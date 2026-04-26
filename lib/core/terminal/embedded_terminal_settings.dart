import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum TerminalThemeId { pickforgeEmber, draculaDark, solarizedDark }

class EmbeddedTerminalSettings extends Equatable {
  const EmbeddedTerminalSettings({
    required this.fontFamily,
    required this.fontSize,
    required this.themeId,
  });

  static const defaults = EmbeddedTerminalSettings(
    fontFamily: 'monospace',
    fontSize: 13,
    themeId: TerminalThemeId.pickforgeEmber,
  );

  final String fontFamily;
  final double fontSize;
  final TerminalThemeId themeId;

  @override
  List<Object?> get props => [fontFamily, fontSize, themeId];
}

@lazySingleton
class EmbeddedTerminalSettingsRepository {
  EmbeddedTerminalSettingsRepository(this._prefs);

  final SharedPreferences _prefs;

  Future<EmbeddedTerminalSettings> load() async {
    return EmbeddedTerminalSettings(
      fontFamily: _prefs.getString('terminal.fontFamily') ??
          EmbeddedTerminalSettings.defaults.fontFamily,
      fontSize: _prefs.getDouble('terminal.fontSize') ??
          EmbeddedTerminalSettings.defaults.fontSize,
      themeId: TerminalThemeId.values.firstWhere(
        (t) => t.name == _prefs.getString('terminal.themeId'),
        orElse: () => EmbeddedTerminalSettings.defaults.themeId,
      ),
    );
  }

  Future<void> save(EmbeddedTerminalSettings s) async {
    await _prefs.setString('terminal.fontFamily', s.fontFamily);
    await _prefs.setDouble('terminal.fontSize', s.fontSize);
    await _prefs.setString('terminal.themeId', s.themeId.name);
  }
}
