import 'package:equatable/equatable.dart';

enum EmulatorGpuMode {
  auto('auto', 'Auto'),
  host('host', 'Host'),
  software('software', 'Software'),
  lavapipe('lavapipe', 'Lavapipe'),
  swiftshader('swiftshader', 'SwiftShader'),
  swangle('swangle', 'Swangle');

  const EmulatorGpuMode(this.cliValue, this.label);

  final String cliValue;
  final String label;

  static EmulatorGpuMode? fromCliValue(String? value) {
    if (value == null || value.isEmpty) return null;
    for (final mode in values) {
      if (mode.cliValue == value) return mode;
    }
    throw FormatException('Unknown emulator GPU mode: $value');
  }
}

class EmulatorLaunchOptions extends Equatable {
  const EmulatorLaunchOptions({
    this.noAudio = false,
    this.gpuMode,
    this.noSnapshotLoad = false,
    this.port,
    this.cores,
  });

  factory EmulatorLaunchOptions.fromJson(Map<String, Object?> json) {
    final options = EmulatorLaunchOptions(
      noAudio: json['noAudio'] == true,
      gpuMode: EmulatorGpuMode.fromCliValue(json['gpuMode'] as String?),
      noSnapshotLoad: json['noSnapshotLoad'] == true,
      port: _readNullableInt(json['port']),
      cores: _readNullableInt(json['cores']),
    );
    final errors = options.validationErrors;
    if (errors.isNotEmpty) {
      throw FormatException(errors.join('\n'));
    }
    return options;
  }

  static const minPort = 5554;
  static const maxPort = 5682;

  final bool noAudio;
  final EmulatorGpuMode? gpuMode;
  final bool noSnapshotLoad;
  final int? port;
  final int? cores;

  bool get isDefault =>
      !noAudio &&
      gpuMode == null &&
      !noSnapshotLoad &&
      port == null &&
      cores == null;

  List<String> get validationErrors {
    final errors = <String>[];
    final port = this.port;
    if (port != null && (port < minPort || port > maxPort || port.isOdd)) {
      errors.add('Port must be an even integer from $minPort to $maxPort.');
    }
    final cores = this.cores;
    if (cores != null && cores < 1) {
      errors.add('CPU cores must be greater than zero.');
    }
    return errors;
  }

  List<String> toEmulatorArgs() {
    final errors = validationErrors;
    if (errors.isNotEmpty) {
      throw ArgumentError(errors.join('\n'));
    }

    return [
      if (noAudio) '-no-audio',
      if (gpuMode case final mode?) ...['-gpu', mode.cliValue],
      if (noSnapshotLoad) '-no-snapshot-load',
      if (port case final port?) ...['-port', '$port'],
      if (cores case final cores?) ...['-cores', '$cores'],
    ];
  }

  Map<String, Object?> toJson() => {
        'noAudio': noAudio,
        'gpuMode': gpuMode?.cliValue,
        'noSnapshotLoad': noSnapshotLoad,
        'port': port,
        'cores': cores,
      };

  EmulatorLaunchOptions copyWith({
    bool? noAudio,
    Object? gpuMode = _unset,
    bool? noSnapshotLoad,
    Object? port = _unset,
    Object? cores = _unset,
  }) {
    return EmulatorLaunchOptions(
      noAudio: noAudio ?? this.noAudio,
      gpuMode: gpuMode == _unset ? this.gpuMode : gpuMode as EmulatorGpuMode?,
      noSnapshotLoad: noSnapshotLoad ?? this.noSnapshotLoad,
      port: port == _unset ? this.port : port as int?,
      cores: cores == _unset ? this.cores : cores as int?,
    );
  }

  @override
  List<Object?> get props => [noAudio, gpuMode, noSnapshotLoad, port, cores];
}

int? _readNullableInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  throw FormatException('Expected integer emulator launch option: $value');
}

const _unset = Object();
