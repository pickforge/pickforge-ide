import 'dart:convert';

import 'package:vm_service/vm_service.dart';

class InspectorExtensions {
  InspectorExtensions(this._vm, {required this.isolateId});

  static const objectGroup = 'pickforge';

  final VmService _vm;
  final String isolateId;

  Future<void> setSelectMode({required bool enabled}) async {
    await _vm.callServiceExtension(
      'ext.flutter.inspector.show',
      isolateId: isolateId,
      args: {'enabled': enabled.toString()},
    );
  }

  Future<Map<String, dynamic>?> getSelectedWidget() async {
    final response = await _vm.callServiceExtension(
      'ext.flutter.inspector.getSelectedWidget',
      isolateId: isolateId,
      args: const {'objectGroup': objectGroup},
    );
    return response.json;
  }

  Future<Map<String, dynamic>?> getRootWidgetSummaryTree() async {
    final response = await _vm.callServiceExtension(
      'ext.flutter.inspector.getRootWidgetSummaryTree',
      isolateId: isolateId,
      args: const {'objectGroup': objectGroup},
    );
    return response.json;
  }

  Future<List<int>> screenshot() async {
    final response = await _vm.callServiceExtension(
      'ext.flutter.inspector.screenshot',
      isolateId: isolateId,
    );
    final encoded = response.json?['screenshot'] as String?;
    if (encoded == null) return const [];
    return const Base64Decoder().convert(encoded);
  }
}
