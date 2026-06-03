import 'package:equatable/equatable.dart';

class EmulatorIdleShutdownSettings extends Equatable {
  const EmulatorIdleShutdownSettings({
    this.enabled = false,
    this.requireConfirmation = true,
  });

  factory EmulatorIdleShutdownSettings.fromJson(Map<String, Object?> json) {
    return EmulatorIdleShutdownSettings(
      enabled: json['enabled'] as bool? ?? false,
      requireConfirmation: json['requireConfirmation'] as bool? ?? true,
    );
  }

  final bool enabled;
  final bool requireConfirmation;

  bool get isDefault => !enabled && requireConfirmation;

  Map<String, Object?> toJson() => {
        'enabled': enabled,
        'requireConfirmation': requireConfirmation,
      };

  EmulatorIdleShutdownSettings copyWith({
    bool? enabled,
    bool? requireConfirmation,
  }) {
    final nextEnabled = enabled ?? this.enabled;
    return EmulatorIdleShutdownSettings(
      enabled: nextEnabled,
      requireConfirmation:
          !nextEnabled || (requireConfirmation ?? this.requireConfirmation),
    );
  }

  @override
  List<Object?> get props => [enabled, requireConfirmation];
}
