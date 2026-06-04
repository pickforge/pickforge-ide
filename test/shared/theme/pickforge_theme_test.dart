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

    test('dark color pairs meet AA text contrast', () {
      final scheme = PickforgeTheme.dark().colorScheme;
      expect(
        _contrastRatio(scheme.onSurface, scheme.surface),
        greaterThanOrEqualTo(4.5),
        reason: 'surface/onSurface',
      );
      expect(
        _contrastRatio(scheme.onPrimary, scheme.primary),
        greaterThanOrEqualTo(4.5),
        reason: 'primary/onPrimary',
      );
      expect(
        _contrastRatio(scheme.onSecondary, scheme.secondary),
        greaterThanOrEqualTo(4.5),
        reason: 'secondary/onSecondary',
      );
      expect(
        _contrastRatio(scheme.onError, scheme.error),
        greaterThanOrEqualTo(4.5),
        reason: 'error/onError',
      );
    });

    test('uses sans for chrome and mono for code', () {
      final theme = PickforgeTheme.dark();
      expect(theme.textTheme.bodyMedium?.fontFamily, 'Inter');
      expect(theme.textTheme.displayLarge?.letterSpacing, 0);
      expect(theme.textTheme.titleLarge?.letterSpacing, 0);
      expect(theme.textTheme.labelSmall?.letterSpacing, 0);
      expect(
        theme.extension<PickforgeMonoTheme>()?.fontFamily,
        'JetBrainsMono',
      );
    });
  });
}

double _contrastRatio(Color foreground, Color background) {
  final foregroundLuminance = foreground.computeLuminance();
  final backgroundLuminance = background.computeLuminance();
  final lighter = foregroundLuminance > backgroundLuminance
      ? foregroundLuminance
      : backgroundLuminance;
  final darker = foregroundLuminance > backgroundLuminance
      ? backgroundLuminance
      : foregroundLuminance;
  return (lighter + 0.05) / (darker + 0.05);
}
