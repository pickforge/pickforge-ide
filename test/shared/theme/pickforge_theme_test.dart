import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

void main() {
  group('PickforgeTheme', () {
    test('dark theme uses near-black surface, not pure black', () {
      final theme = PickforgeTheme.dark();
      expect(theme.brightness, Brightness.dark);
      expect(theme.colorScheme.surface, isNot(Colors.black));
      expect(theme.colorScheme.surface.computeLuminance(), lessThan(0.05));
    });

    test('primary accent is forge-ember orange in dark', () {
      final theme = PickforgeTheme.dark();
      expect(theme.colorScheme.primary, const Color(0xFFFF7A1A));
    });

    test('uses sans for chrome and mono for code', () {
      final theme = PickforgeTheme.dark();
      expect(theme.textTheme.bodyMedium?.fontFamily, 'Inter');
      expect(
        theme.extension<PickforgeMonoTheme>()?.fontFamily,
        'JetBrainsMono',
      );
    });
  });
}
