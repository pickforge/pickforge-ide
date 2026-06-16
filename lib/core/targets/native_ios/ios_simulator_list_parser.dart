import 'dart:convert';

import 'package:equatable/equatable.dart';

/// An iOS Simulator device parsed from `xcrun simctl list devices --json`.
class IosSimulator extends Equatable {
  const IosSimulator({
    required this.udid,
    required this.name,
    required this.state,
    required this.runtime,
    required this.isAvailable,
  });

  final String udid;
  final String name;

  /// e.g. `Booted`, `Shutdown`.
  final String state;

  /// The runtime identifier suffix, e.g. `iOS-17-0`.
  final String runtime;
  final bool isAvailable;

  bool get isBooted => state == 'Booted';

  @override
  List<Object?> get props => [udid, name, state, runtime, isAvailable];
}

/// Parses the JSON from `xcrun simctl list devices --json` into a flat,
/// runtime-tagged simulator list. Tolerant: malformed JSON or unexpected shapes
/// yield an empty list rather than throwing.
class IosSimulatorListParser {
  const IosSimulatorListParser();

  List<IosSimulator> parse(String json) {
    final Object? decoded;
    try {
      decoded = jsonDecode(json);
    } on FormatException {
      return const [];
    }
    if (decoded is! Map<String, Object?>) return const [];
    final devices = decoded['devices'];
    if (devices is! Map<String, Object?>) return const [];

    final simulators = <IosSimulator>[];
    for (final entry in devices.entries) {
      final runtime = _shortRuntime(entry.key);
      final list = entry.value;
      if (list is! List) continue;
      for (final item in list.whereType<Map<String, Object?>>()) {
        final udid = item['udid'];
        final name = item['name'];
        if (udid is! String || name is! String) continue;
        simulators.add(
          IosSimulator(
            udid: udid,
            name: name,
            state: item['state'] is String ? item['state']! as String : '',
            runtime: runtime,
            isAvailable: item['isAvailable'] == true,
          ),
        );
      }
    }
    return simulators;
  }

  /// `com.apple.CoreSimulator.SimRuntime.iOS-17-0` → `iOS-17-0`.
  String _shortRuntime(String runtimeKey) {
    const marker = 'SimRuntime.';
    final index = runtimeKey.indexOf(marker);
    return index == -1
        ? runtimeKey
        : runtimeKey.substring(index + marker.length);
  }
}
