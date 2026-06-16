import 'dart:collection';

import 'package:equatable/equatable.dart';

/// A single capability a target adapter may expose.
///
/// Capabilities gate which operations the workbench offers for the active
/// target. Adapters only declare what they actually implement; unsupported
/// operations are simply absent from [TargetCapabilities].
enum TargetCapability {
  detect,
  launch,
  stop,
  hotReload,
  hotRestart,
  captureScreenshot,
  streamLogs,
  inspectSelection,
  mapSelectionToSource,
  exposeMcpTools,
}

/// The set of [TargetCapability] values an adapter supports.
///
/// Iteration order is not relied upon. [values] is exposed as an unmodifiable
/// view so capabilities can't be mutated after construction.
class TargetCapabilities extends Equatable {
  const TargetCapabilities(this._values);

  /// No capabilities — useful as a default for adapters under construction.
  static const TargetCapabilities none =
      TargetCapabilities(<TargetCapability>{});

  final Set<TargetCapability> _values;

  /// The supported capabilities, as an unmodifiable view.
  Set<TargetCapability> get values => UnmodifiableSetView(_values);

  bool has(TargetCapability capability) => _values.contains(capability);

  @override
  List<Object?> get props => [_values];
}
