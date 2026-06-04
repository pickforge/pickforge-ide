import 'dart:convert';

import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/rebuild_stats_decoder.dart';
import 'package:vm_service/vm_service.dart';

class InspectorExtensions {
  InspectorExtensions(this._vm, {required this.isolateId});

  static const objectGroup = 'pickforge';

  final VmService _vm;
  final String isolateId;
  final _rebuildStatsDecoder = RebuildStatsDecoder();

  Future<void> setSelectMode({required bool enabled}) async {
    await _vm.callServiceExtension(
      'ext.flutter.inspector.show',
      isolateId: isolateId,
      args: {'enabled': enabled.toString()},
    );
  }

  Future<void> setTrackRebuildDirtyWidgets({required bool enabled}) async {
    await _vm.callServiceExtension(
      'ext.flutter.inspector.trackRebuildDirtyWidgets',
      isolateId: isolateId,
      args: {'enabled': enabled.toString()},
    );
  }

  Future<void> listenToExtensionEvents() async {
    try {
      await _vm.streamListen(EventStreams.kExtension);
    } on RPCError catch (e) {
      if (e.code != RPCErrorKind.kStreamAlreadySubscribed.code) rethrow;
    }
  }

  Stream<RebuildStats> watchRebuiltWidgets() => _vm.onExtensionEvent
      .map(_rebuildStatsDecoder.decode)
      .where((stats) => stats != null)
      .cast<RebuildStats>();

  Future<Map<String, dynamic>?> getSelectedWidget() async {
    final response = await _vm.callServiceExtension(
      'ext.flutter.inspector.getSelectedWidget',
      isolateId: isolateId,
      args: const {'objectGroup': objectGroup},
    );
    return _mapResult(response);
  }

  Future<Map<String, dynamic>?> getRootWidgetSummaryTree() async {
    final response = await _vm.callServiceExtension(
      'ext.flutter.inspector.getRootWidgetSummaryTree',
      isolateId: isolateId,
      args: const {'objectGroup': objectGroup},
    );
    return _mapResult(response);
  }

  Future<List<int>> screenshot({
    required String id,
    required double width,
    required double height,
    double margin = 0,
    double maxPixelRatio = 1,
    bool debugPaint = false,
  }) async {
    final response = await _vm.callServiceExtension(
      'ext.flutter.inspector.screenshot',
      isolateId: isolateId,
      args: {
        'id': id,
        'width': width.toString(),
        'height': height.toString(),
        'margin': margin.toString(),
        'maxPixelRatio': maxPixelRatio.toString(),
        'debugPaint': debugPaint.toString(),
      },
    );
    final encoded = response.json?['result'] as String?;
    if (encoded == null) return const [];
    return const Base64Decoder().convert(encoded);
  }

  Map<String, dynamic>? _mapResult(Response response) {
    final json = response.json;
    final result = json?['result'];
    if (json?.containsKey('result') == true && result == null) return null;
    if (result is Map<String, dynamic>) return result;
    if (result is Map) return Map<String, dynamic>.from(result);
    return json;
  }
}
