import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('defaults when nothing stored', () async {
    final repo = EmbeddedTerminalSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    final s = await repo.load();
    expect(s.fontSize, 13.0);
    expect(s.themeId, TerminalThemeId.pickforgeEmber);
  });

  test('save then load round-trips', () async {
    final repo = EmbeddedTerminalSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repo.save(
      const EmbeddedTerminalSettings(
        fontFamily: 'JetBrains Mono',
        fontSize: 14,
        themeId: TerminalThemeId.solarizedDark,
      ),
    );
    final s = await repo.load();
    expect(s.fontFamily, 'JetBrains Mono');
    expect(s.fontSize, 14);
    expect(s.themeId, TerminalThemeId.solarizedDark);
  });
}
