import 'dart:ui';

import 'package:pickforge/core/targets/react_native/react_native_adb_service.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_parser.dart';

/// Reads the live UIAutomator hierarchy from a device and answers selection
/// queries against it.
///
/// Combines [ReactNativeAdbService.dumpUiAutomatorXml] with the parser; returns
/// `null` whenever the dump is unavailable or unparseable rather than throwing.
class ReactNativeUiInspector {
  const ReactNativeUiInspector(
    this._adb, {
    ReactNativeUiAutomatorParser parser = const ReactNativeUiAutomatorParser(),
  }) : _parser = parser;

  final ReactNativeAdbService _adb;
  final ReactNativeUiAutomatorParser _parser;

  Future<ReactNativeA11yNode?> inspect({required String serial}) async {
    final xml = await _adb.dumpUiAutomatorXml(serial: serial);
    if (xml == null) return null;
    try {
      return _parser.parse(xml);
    } on FormatException {
      return null;
    }
  }

  Future<ReactNativeA11yNode?> selectedAt({
    required String serial,
    required Offset devicePoint,
  }) async {
    final root = await inspect(serial: serial);
    if (root == null) return null;
    return _parser.hitTest(root, devicePoint);
  }
}
