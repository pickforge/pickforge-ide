import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

export 'package:pickforge/shared/theme/pickforge_typography.dart'
    show PickforgeMonoTheme, PickforgeText, kPickforgeMono, kPickforgeSans;

/// PickForge theme. Comprehensively overrides Material 3 so the brand's color,
/// type, spacing and motion never leak Material defaults into the UI.
class PickforgeTheme {
  const PickforgeTheme._();

  static ThemeData dark() => _build(Brightness.dark);
  static ThemeData light() => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final scheme = isDark ? _darkScheme : _lightScheme;
    final text = pickforgeTextTheme(brightness: brightness);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      canvasColor: scheme.surface,
      textTheme: text,
      fontFamily: kPickforgeSans,
      extensions: const [PickforgeMonoTheme(fontFamily: kPickforgeMono)],
      splashFactory: NoSplash.splashFactory,
      highlightColor: Colors.transparent,
      hoverColor: PickforgeColors.hairline,
      visualDensity: VisualDensity.compact,
      dividerColor: PickforgeColors.hairline,
      dividerTheme: const DividerThemeData(
        color: PickforgeColors.hairline,
        thickness: 1,
        space: 1,
      ),
      iconTheme: IconThemeData(color: scheme.onSurfaceVariant, size: 18),
      textSelectionTheme: const TextSelectionThemeData(
        cursorColor: PickforgeColors.ember,
        selectionColor: Color(0x33FF7A1A),
        selectionHandleColor: PickforgeColors.ember,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: text.titleLarge,
        centerTitle: false,
      ),
      filledButtonTheme: FilledButtonThemeData(style: _emberButtonStyle(text)),
      elevatedButtonTheme:
          ElevatedButtonThemeData(style: _emberButtonStyle(text)),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.hovered)
                ? PickforgeColors.emberSoft
                : PickforgeColors.ember,
          ),
          textStyle: WidgetStatePropertyAll(text.labelLarge),
          side: WidgetStateProperty.resolveWith(
            (s) => BorderSide(
              color: s.contains(WidgetState.hovered)
                  ? PickforgeColors.ember.withValues(alpha: 0.5)
                  : PickforgeColors.hairlineStrong,
            ),
          ),
          shape: const WidgetStatePropertyAll(
            StadiumBorder(),
          ),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.lg,
              vertical: PickforgeSpacing.sm + 2,
            ),
          ),
          overlayColor: const WidgetStatePropertyAll(Color(0x11FF7A1A)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.hovered)
                ? PickforgeColors.emberSoft
                : PickforgeColors.ember,
          ),
          textStyle: WidgetStatePropertyAll(text.labelLarge),
          overlayColor: const WidgetStatePropertyAll(Color(0x11FF7A1A)),
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.hovered)
                ? PickforgeColors.textHi
                : scheme.onSurfaceVariant,
          ),
          overlayColor: const WidgetStatePropertyAll(PickforgeColors.hairline),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainer,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: PickforgeSpacing.md,
          vertical: PickforgeSpacing.sm + 2,
        ),
        hintStyle: text.bodyMedium?.copyWith(color: PickforgeColors.textLow),
        helperStyle: text.labelSmall,
        border: _inputBorder(PickforgeColors.hairline),
        enabledBorder: _inputBorder(PickforgeColors.hairline),
        focusedBorder: _inputBorder(PickforgeColors.ember, width: 1.5),
        errorBorder: _inputBorder(PickforgeColors.error),
        focusedErrorBorder: _inputBorder(PickforgeColors.error, width: 1.5),
      ),
      dropdownMenuTheme: DropdownMenuThemeData(
        textStyle: text.bodyMedium,
        menuStyle: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(scheme.surfaceContainerHigh),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
              side: const BorderSide(color: PickforgeColors.hairline),
            ),
          ),
        ),
      ),
      menuTheme: MenuThemeData(
        style: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(scheme.surfaceContainerHigh),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
              side: const BorderSide(color: PickforgeColors.hairline),
            ),
          ),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: scheme.surfaceContainerHigh,
        surfaceTintColor: Colors.transparent,
        elevation: 12,
        textStyle: text.bodyMedium,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
          side: const BorderSide(color: PickforgeColors.hairline),
        ),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
          border: Border.all(color: PickforgeColors.hairline),
        ),
        textStyle: text.labelMedium?.copyWith(color: PickforgeColors.textHi),
        waitDuration: const Duration(milliseconds: 400),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainer,
        surfaceTintColor: Colors.transparent,
        elevation: 24,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusLg),
          side: const BorderSide(color: PickforgeColors.hairline),
        ),
        titleTextStyle: text.titleLarge,
        contentTextStyle: text.bodyMedium,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: scheme.surfaceContainerHighest,
        contentTextStyle: text.bodyMedium,
        actionTextColor: PickforgeColors.ember,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
          side: const BorderSide(color: PickforgeColors.hairline),
        ),
      ),
      sliderTheme: const SliderThemeData(
        activeTrackColor: PickforgeColors.ember,
        inactiveTrackColor: PickforgeColors.surface3,
        thumbColor: PickforgeColors.ember,
        overlayColor: Color(0x22FF7A1A),
        trackHeight: 3,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? PickforgeColors.surface
              : PickforgeColors.textMed,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? PickforgeColors.ember
              : PickforgeColors.surface3,
        ),
        trackOutlineColor:
            const WidgetStatePropertyAll(PickforgeColors.hairline),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? PickforgeColors.ember
              : Colors.transparent,
        ),
        checkColor: const WidgetStatePropertyAll(PickforgeColors.surface),
        side: const BorderSide(color: PickforgeColors.hairlineStrong),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected)
              ? PickforgeColors.ember
              : PickforgeColors.textLow,
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: PickforgeColors.ember,
        linearTrackColor: PickforgeColors.surface3,
        circularTrackColor: PickforgeColors.surface3,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: scheme.onSurfaceVariant,
        textColor: scheme.onSurface,
        dense: true,
        minLeadingWidth: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        ),
      ),
      scrollbarTheme: const ScrollbarThemeData(
        thumbColor: WidgetStatePropertyAll(Color(0x22FFFFFF)),
        thickness: WidgetStatePropertyAll(6),
        radius: Radius.circular(8),
        crossAxisMargin: 2,
      ),
    );
  }

  static ButtonStyle _emberButtonStyle(TextTheme text) => ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) {
            if (s.contains(WidgetState.disabled)) {
              return PickforgeColors.surface3;
            }
            if (s.contains(WidgetState.pressed)) {
              return PickforgeColors.emberDeep;
            }
            if (s.contains(WidgetState.hovered)) {
              return PickforgeColors.emberSoft;
            }
            return PickforgeColors.ember;
          },
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.disabled)
              ? PickforgeColors.textLow
              : PickforgeColors.surface,
        ),
        textStyle: WidgetStatePropertyAll(text.labelLarge),
        elevation: const WidgetStatePropertyAll(0),
        shadowColor: const WidgetStatePropertyAll(Colors.transparent),
        shape: const WidgetStatePropertyAll(StadiumBorder()),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(
            horizontal: PickforgeSpacing.lg,
            vertical: PickforgeSpacing.sm + 2,
          ),
        ),
        overlayColor: const WidgetStatePropertyAll(Color(0x1A000000)),
      );

  static OutlineInputBorder _inputBorder(Color color, {double width = 1}) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        borderSide: BorderSide(color: color, width: width),
      );

  // ── Color schemes ─────────────────────────────────────────────────────────
  static const ColorScheme _darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: PickforgeColors.ember,
    onPrimary: PickforgeColors.surface,
    primaryContainer: Color(0xFF2A1607),
    onPrimaryContainer: PickforgeColors.emberSoft,
    secondary: PickforgeColors.info,
    onSecondary: PickforgeColors.surface,
    secondaryContainer: Color(0xFF13203A),
    onSecondaryContainer: PickforgeColors.info,
    tertiary: PickforgeColors.connected,
    onTertiary: PickforgeColors.surface,
    tertiaryContainer: Color(0xFF0E2A1E),
    onTertiaryContainer: PickforgeColors.connected,
    error: PickforgeColors.error,
    onError: PickforgeColors.surface,
    errorContainer: Color(0xFF3A1512),
    onErrorContainer: PickforgeColors.error,
    surface: PickforgeColors.surface,
    onSurface: PickforgeColors.textHi,
    onSurfaceVariant: PickforgeColors.textMed,
    surfaceContainerLowest: PickforgeColors.surface,
    surfaceContainerLow: PickforgeColors.surface1,
    surfaceContainer: PickforgeColors.surface1,
    surfaceContainerHigh: PickforgeColors.surface2,
    surfaceContainerHighest: PickforgeColors.surface3,
    surfaceDim: PickforgeColors.surface,
    surfaceBright: PickforgeColors.surface2,
    outline: PickforgeColors.hairlineStrong,
    outlineVariant: PickforgeColors.hairline,
    shadow: Color(0xFF000000),
    scrim: Color(0xCC000000),
    inverseSurface: PickforgeColors.textHi,
    onInverseSurface: PickforgeColors.surface,
    inversePrimary: PickforgeColors.emberDeep,
    surfaceTint: Colors.transparent,
  );

  static const ColorScheme _lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: PickforgeColors.ember,
    onPrimary: Color(0xFFFFFFFF),
    primaryContainer: Color(0xFFFFE3CC),
    onPrimaryContainer: PickforgeColors.emberDeep,
    secondary: Color(0xFF3A5BD6),
    onSecondary: Color(0xFFFFFFFF),
    secondaryContainer: Color(0xFFDDE4FF),
    onSecondaryContainer: Color(0xFF14215A),
    tertiary: Color(0xFF1FA76A),
    onTertiary: Color(0xFFFFFFFF),
    tertiaryContainer: Color(0xFFCFF2E2),
    onTertiaryContainer: Color(0xFF0B3D28),
    error: Color(0xFFD0453B),
    onError: Color(0xFFFFFFFF),
    errorContainer: Color(0xFFFFDAD5),
    onErrorContainer: Color(0xFF5A1610),
    surface: Color(0xFFF7F7F8),
    onSurface: Color(0xFF151110),
    onSurfaceVariant: Color(0xFF55555C),
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFF2F2F4),
    surfaceContainer: Color(0xFFECECEF),
    surfaceContainerHigh: Color(0xFFE6E6EA),
    surfaceContainerHighest: Color(0xFFE0E0E5),
    surfaceDim: Color(0xFFDDDDE2),
    surfaceBright: Color(0xFFFFFFFF),
    outline: Color(0x1F0A0A0B),
    outlineVariant: Color(0x140A0A0B),
    shadow: Color(0xFF000000),
    scrim: Color(0x99000000),
    inverseSurface: Color(0xFF1B1B1F),
    onInverseSurface: Color(0xFFF2F2F3),
    inversePrimary: PickforgeColors.emberSoft,
    surfaceTint: Colors.transparent,
  );
}
