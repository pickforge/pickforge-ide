import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

export 'package:pickforge/shared/theme/pickforge_typography.dart'
    show PickforgeMonoTheme, PickforgeText, kPickforgeMono, kPickforgeSans;

/// PickForge theme. Comprehensively overrides Material 3 so the brand's color,
/// type, spacing and motion never leak Material defaults into the UI.
///
/// Both modes build from a [PickforgePalette]: dark is the canonical brand
/// canvas, light is the token inversion map from DARK-LIGHT-MODE.md.
class PickforgeTheme {
  const PickforgeTheme._();

  static ThemeData dark() => _build(PickforgePalette.dark);
  static ThemeData light() => _build(PickforgePalette.light);

  /// Desktop Flutter resolves button cursors to the platform arrow
  /// (`adaptiveClickable`); PickForge wants the explicit hand on every
  /// interactive control instead, so hover always signals clickability.
  static const WidgetStateProperty<MouseCursor> clickCursor =
      WidgetStateProperty<MouseCursor>.fromMap({
    WidgetState.disabled: SystemMouseCursors.basic,
    WidgetState.any: SystemMouseCursors.click,
  });

  static ThemeData _build(PickforgePalette p) {
    final scheme = _scheme(p);
    final text = pickforgeTextTheme(brightness: p.brightness);

    return ThemeData(
      useMaterial3: true,
      brightness: p.brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      canvasColor: scheme.surface,
      textTheme: text,
      fontFamily: kPickforgeSans,
      extensions: const [PickforgeMonoTheme(fontFamily: kPickforgeMono)],
      splashFactory: NoSplash.splashFactory,
      highlightColor: Colors.transparent,
      hoverColor: p.hairline,
      visualDensity: VisualDensity.compact,
      dividerColor: p.hairline,
      dividerTheme: DividerThemeData(
        color: p.hairline,
        thickness: 1,
        space: 1,
      ),
      iconTheme: IconThemeData(color: scheme.onSurfaceVariant, size: 18),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: p.ember,
        selectionColor: p.ember.withValues(alpha: 0.2),
        selectionHandleColor: p.ember,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: text.titleLarge,
        centerTitle: false,
      ),
      filledButtonTheme:
          FilledButtonThemeData(style: _emberButtonStyle(p, text)),
      elevatedButtonTheme:
          ElevatedButtonThemeData(style: _emberButtonStyle(p, text)),
      // Secondary actions are quiet — off-white on hairline. Ember is reserved
      // for the single primary action of a composition (one ember per surface).
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.hovered) ? p.textHi : p.textMed,
          ),
          textStyle: WidgetStatePropertyAll(text.labelLarge),
          side: WidgetStateProperty.resolveWith(
            (s) => BorderSide(
              color: s.contains(WidgetState.hovered)
                  ? p.textHi.withValues(alpha: 0.25)
                  : p.hairlineStrong,
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
          overlayColor: WidgetStatePropertyAll(p.itemFill),
          mouseCursor: clickCursor,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.hovered) ? p.textHi : p.textMed,
          ),
          textStyle: WidgetStatePropertyAll(text.labelLarge),
          overlayColor: WidgetStatePropertyAll(p.itemFill),
          mouseCursor: clickCursor,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.hovered)
                ? p.textHi
                : scheme.onSurfaceVariant,
          ),
          overlayColor: WidgetStatePropertyAll(p.hairline),
          mouseCursor: clickCursor,
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
        hintStyle: text.bodyMedium?.copyWith(color: p.textLow),
        helperStyle: text.labelSmall,
        border: _inputBorder(p.hairline),
        enabledBorder: _inputBorder(p.hairline),
        focusedBorder: _inputBorder(p.ember, width: 1.5),
        errorBorder: _inputBorder(p.error),
        focusedErrorBorder: _inputBorder(p.error, width: 1.5),
      ),
      dropdownMenuTheme: DropdownMenuThemeData(
        textStyle: text.bodyMedium,
        menuStyle: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(scheme.surfaceContainerHigh),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
              side: BorderSide(color: p.hairline),
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
              side: BorderSide(color: p.hairline),
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
          side: BorderSide(color: p.hairline),
        ),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
          border: Border.all(color: p.hairline),
        ),
        textStyle: text.labelMedium?.copyWith(color: p.textHi),
        waitDuration: const Duration(milliseconds: 400),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surfaceContainer,
        surfaceTintColor: Colors.transparent,
        elevation: 24,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusLg),
          side: BorderSide(color: p.hairline),
        ),
        titleTextStyle: text.titleLarge,
        contentTextStyle: text.bodyMedium,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: scheme.surfaceContainerHighest,
        contentTextStyle: text.bodyMedium,
        actionTextColor: p.ember,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
          side: BorderSide(color: p.hairline),
        ),
      ),
      sliderTheme: SliderThemeData(
        activeTrackColor: p.ember,
        inactiveTrackColor: p.surface3,
        thumbColor: p.ember,
        overlayColor: p.ember.withValues(alpha: 0.13),
        trackHeight: 3,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.surface : p.textMed,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.ember : p.surface3,
        ),
        trackOutlineColor: WidgetStatePropertyAll(p.hairline),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) =>
              s.contains(WidgetState.selected) ? p.ember : Colors.transparent,
        ),
        checkColor: WidgetStatePropertyAll(p.surface),
        side: BorderSide(color: p.hairlineStrong),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? p.ember : p.textLow,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: p.ember,
        linearTrackColor: p.surface3,
        circularTrackColor: p.surface3,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: scheme.onSurfaceVariant,
        textColor: scheme.onSurface,
        dense: true,
        minLeadingWidth: 0,
        mouseCursor: clickCursor,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        ),
      ),
      toggleButtonsTheme: ToggleButtonsThemeData(
        color: p.textMed,
        selectedColor: p.textHi,
        fillColor: p.surface2,
        hoverColor: p.hairline,
        borderColor: p.hairlineStrong,
        selectedBorderColor: p.hairlineStrong,
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          backgroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected)
                ? p.surface2
                : Colors.transparent,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? p.textHi : p.textMed,
          ),
          textStyle: WidgetStatePropertyAll(text.labelMedium),
          side: WidgetStatePropertyAll(BorderSide(color: p.hairlineStrong)),
          visualDensity: VisualDensity.compact,
        ),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStatePropertyAll(
          p.textHi.withValues(alpha: 0.13),
        ),
        thickness: const WidgetStatePropertyAll(6),
        radius: const Radius.circular(8),
        crossAxisMargin: 2,
      ),
    );
  }

  static ButtonStyle _emberButtonStyle(PickforgePalette p, TextTheme text) =>
      ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) {
            if (s.contains(WidgetState.disabled)) return p.surface3;
            if (s.contains(WidgetState.pressed)) return p.emberDeep;
            if (s.contains(WidgetState.hovered)) return p.emberSoft;
            return p.ember;
          },
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.disabled)
              ? p.textLow
              : (p.brightness == Brightness.dark
                  ? p.surface
                  : const Color(0xFFFFFFFF)),
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
        mouseCursor: clickCursor,
      );

  static OutlineInputBorder _inputBorder(Color color, {double width = 1}) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        borderSide: BorderSide(color: color, width: width),
      );

  // ── Color scheme (derived from the palette) ───────────────────────────────
  static ColorScheme _scheme(PickforgePalette p) {
    final isDark = p.brightness == Brightness.dark;
    return ColorScheme(
      brightness: p.brightness,
      primary: p.ember,
      onPrimary: isDark ? p.surface : const Color(0xFFFFFFFF),
      primaryContainer:
          isDark ? const Color(0xFF2A1607) : const Color(0xFFFFE3CC),
      onPrimaryContainer: isDark ? p.emberSoft : p.emberDeep,
      secondary: p.info,
      onSecondary: isDark ? p.surface : const Color(0xFFFFFFFF),
      secondaryContainer:
          isDark ? const Color(0xFF13203A) : const Color(0xFFDDE4FF),
      onSecondaryContainer: isDark ? p.info : const Color(0xFF14215A),
      tertiary: p.connected,
      onTertiary: isDark ? p.surface : const Color(0xFFFFFFFF),
      tertiaryContainer:
          isDark ? const Color(0xFF0E2A1E) : const Color(0xFFCFF2E2),
      onTertiaryContainer: isDark ? p.connected : const Color(0xFF0B3D28),
      error: p.error,
      onError: isDark ? p.surface : const Color(0xFFFFFFFF),
      errorContainer:
          isDark ? const Color(0xFF3A1512) : const Color(0xFFFFDAD5),
      onErrorContainer: isDark ? p.error : const Color(0xFF5A1610),
      surface: p.surface,
      onSurface: p.textHi,
      onSurfaceVariant: p.textMed,
      surfaceContainerLowest: p.surface,
      surfaceContainerLow: p.surface1,
      surfaceContainer: p.surface1,
      surfaceContainerHigh: p.surface2,
      surfaceContainerHighest: p.surface3,
      surfaceDim: p.surface,
      surfaceBright: p.surface2,
      outline: p.hairlineStrong,
      outlineVariant: p.hairline,
      shadow: const Color(0xFF000000),
      scrim: isDark ? const Color(0xCC000000) : const Color(0x99000000),
      inverseSurface: p.textHi,
      onInverseSurface: p.surface,
      inversePrimary: isDark ? p.emberDeep : p.emberSoft,
      surfaceTint: Colors.transparent,
    );
  }
}
