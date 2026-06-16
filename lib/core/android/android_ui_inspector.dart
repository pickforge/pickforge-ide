import 'dart:ui';

import 'package:pickforge/core/android/android_adb_service.dart';
import 'package:pickforge/core/android/android_uiautomator_node.dart';
import 'package:pickforge/core/android/android_uiautomator_parser.dart';

/// Reads the live UIAutomator hierarchy from a device and answers selection
/// queries against it. Shared by every Android-backed target.
///
/// Combines [AndroidAdbService.dumpUiAutomatorXml] with the parser; returns
/// `null` whenever the dump is unavailable or unparseable rather than throwing.
class AndroidUiInspector {
  const AndroidUiInspector(
    this._adb, {
    AndroidUiAutomatorParser parser = const AndroidUiAutomatorParser(),
  }) : _parser = parser;

  final AndroidAdbService _adb;
  final AndroidUiAutomatorParser _parser;

  Future<AndroidA11yNode?> inspect({required String serial}) async {
    final xml = await _adb.dumpUiAutomatorXml(serial: serial);
    if (xml == null) return null;
    try {
      return _parser.parse(xml);
    } on FormatException {
      return null;
    }
  }

  Future<AndroidA11yNode?> selectedAt({
    required String serial,
    required Offset devicePoint,
  }) async {
    final root = await inspect(serial: serial);
    if (root == null) return null;
    return _parser.hitTest(root, devicePoint);
  }
}
