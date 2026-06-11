import 'package:equatable/equatable.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Which brand mode the app renders in. Dark is the canonical brand canvas
/// (the brand is dark-first); light is the DARK-LIGHT-MODE.md inversion map.
enum AppearanceThemeMode { system, dark, light }

/// What the workbench canvas paints behind the panels.
enum WorkbenchBackdrop {
  /// The forge: a soft ember glow rising from the bottom of the canvas,
  /// optionally with drifting ember particles.
  forge,

  /// The plain brand surface, no glow.
  plain,
}

class AppearanceSettings extends Equatable {
  const AppearanceSettings({
    required this.themeMode,
    required this.backdrop,
    required this.animatedBackdrop,
  });

  static const defaults = AppearanceSettings(
    themeMode: AppearanceThemeMode.dark,
    backdrop: WorkbenchBackdrop.forge,
    animatedBackdrop: true,
  );

  final AppearanceThemeMode themeMode;
  final WorkbenchBackdrop backdrop;

  /// Whether the forge backdrop drifts its embers. Ignored when [backdrop]
  /// is plain; always overridden by the OS reduce-motion preference.
  final bool animatedBackdrop;

  AppearanceSettings copyWith({
    AppearanceThemeMode? themeMode,
    WorkbenchBackdrop? backdrop,
    bool? animatedBackdrop,
  }) {
    return AppearanceSettings(
      themeMode: themeMode ?? this.themeMode,
      backdrop: backdrop ?? this.backdrop,
      animatedBackdrop: animatedBackdrop ?? this.animatedBackdrop,
    );
  }

  @override
  List<Object?> get props => [themeMode, backdrop, animatedBackdrop];
}

class AppearanceSettingsRepository {
  AppearanceSettingsRepository(this._prefs);

  final SharedPreferences _prefs;

  static const _themeModeKey = 'appearance.themeMode';
  static const _backdropKey = 'appearance.backdrop';
  static const _animatedKey = 'appearance.animatedBackdrop';

  AppearanceSettings load() {
    return AppearanceSettings(
      themeMode: AppearanceThemeMode.values.firstWhere(
        (m) => m.name == _prefs.getString(_themeModeKey),
        orElse: () => AppearanceSettings.defaults.themeMode,
      ),
      backdrop: WorkbenchBackdrop.values.firstWhere(
        (b) => b.name == _prefs.getString(_backdropKey),
        orElse: () => AppearanceSettings.defaults.backdrop,
      ),
      animatedBackdrop: _prefs.getBool(_animatedKey) ??
          AppearanceSettings.defaults.animatedBackdrop,
    );
  }

  Future<void> save(AppearanceSettings s) async {
    await _prefs.setString(_themeModeKey, s.themeMode.name);
    await _prefs.setString(_backdropKey, s.backdrop.name);
    await _prefs.setBool(_animatedKey, s.animatedBackdrop);
  }
}

/// The app-wide appearance state. Owns the active [PickforgePalette]: it must
/// be swapped *before* the tree rebuilds so the static token getters resolve
/// against the right mode everywhere.
class AppearanceController extends ValueNotifier<AppearanceSettings> {
  AppearanceController(this._repository) : super(AppearanceSettings.defaults) {
    _syncPalette();
  }

  final AppearanceSettingsRepository _repository;

  /// Loads persisted settings. Call before `runApp` so the first frame paints
  /// in the right mode (no theme flash).
  void init() {
    value = _repository.load();
  }

  Future<void> update(AppearanceSettings next) async {
    value = next;
    await _repository.save(next);
  }

  /// Re-resolves the palette after the OS brightness changed (only matters
  /// in [AppearanceThemeMode.system]).
  void onPlatformBrightnessChanged() {
    if (value.themeMode != AppearanceThemeMode.system) return;
    _syncPalette();
    notifyListeners();
  }

  ThemeMode get themeMode => switch (value.themeMode) {
        AppearanceThemeMode.system => ThemeMode.system,
        AppearanceThemeMode.dark => ThemeMode.dark,
        AppearanceThemeMode.light => ThemeMode.light,
      };

  Brightness get effectiveBrightness => _brightnessFor(value.themeMode);

  static Brightness _brightnessFor(AppearanceThemeMode mode) => switch (mode) {
        AppearanceThemeMode.dark => Brightness.dark,
        AppearanceThemeMode.light => Brightness.light,
        AppearanceThemeMode.system =>
          PlatformDispatcher.instance.platformBrightness,
      };

  void _syncPalette() {
    PickforgeColors.palette = effectiveBrightness == Brightness.dark
        ? PickforgePalette.dark
        : PickforgePalette.light;
  }

  /// Swaps the palette *before* notifying so every rebuilt widget reads the
  /// new mode's tokens.
  @override
  set value(AppearanceSettings newValue) {
    PickforgeColors.palette =
        _brightnessFor(newValue.themeMode) == Brightness.dark
            ? PickforgePalette.dark
            : PickforgePalette.light;
    super.value = newValue;
  }
}
