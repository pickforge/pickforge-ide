import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/inspector/widget_tree_decoder.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';

class InspectorRepository {
  InspectorRepository(
    this._ext,
    this._source, {
    String? projectRoot,
    ContextStorageService? storage,
  })  : _projectRoot = projectRoot,
        _storage = storage ?? ContextStorageService();

  final InspectorExtensions _ext;
  final SourceSnippetExtractor _source;
  final String? _projectRoot;
  final ContextStorageService _storage;

  Future<void> enableSelectMode() => _ext.setSelectMode(enabled: true);
  Future<void> disableSelectMode() => _ext.setSelectMode(enabled: false);
  Future<void> trackRebuildDirtyWidgets({required bool enabled}) =>
      _ext.setTrackRebuildDirtyWidgets(enabled: enabled);

  Future<void> listenToExtensionEvents() => _ext.listenToExtensionEvents();
  Stream<RebuildStats> watchRebuiltWidgets() => _ext.watchRebuiltWidgets();

  Future<WidgetNode?> captureWidgetTreeSnapshot() async {
    final rawTree = await _ext.getRootWidgetSummaryTree();
    return rawTree == null ? null : WidgetTreeDecoder.decode(rawTree);
  }

  /// Fetches the currently selected widget along with ancestor chain and
  /// source snippet. Returns null if nothing is selected on-device.
  Future<SelectedWidget?> fetchSelection() async {
    final rawSelected = await _ext.getSelectedWidget();
    if (rawSelected == null || rawSelected.isEmpty) return null;

    final node = WidgetTreeDecoder.decode(rawSelected);

    final rawTree = await _ext.getRootWidgetSummaryTree();
    final ancestorClasses = rawTree == null
        ? <String>[]
        : _ancestorsOf(WidgetTreeDecoder.decode(rawTree), node.id);

    final snippet = node.creationLocation == null
        ? null
        : await _source.extract(
            node.creationLocation!,
            projectRoot: _projectRoot,
          );
    final screenshotPath = await _captureScreenshot(node.id);

    return SelectedWidget(
      node: node,
      ancestorClasses: ancestorClasses,
      sourceSnippet: snippet,
      screenshotPath: screenshotPath,
      adbScreenshotPath: null,
      propertiesJson: rawSelected,
    );
  }

  Future<String?> _captureScreenshot(String id) async {
    final projectRoot = _projectRoot;
    if (projectRoot == null) return null;
    try {
      final bytes = await _ext.screenshot(
        id: id,
        width: 480,
        height: 480,
        margin: 16,
        maxPixelRatio: 2,
      );
      if (bytes.isEmpty) return null;
      final resolved = await _storage.ensure(projectRoot);
      final file = File(p.join(resolved.contextDir, 'screenshot.png'));
      await file.writeAsBytes(bytes, flush: true);
      return file.path;
    } on Object {
      return null;
    }
  }

  List<String> _ancestorsOf(WidgetNode root, String targetId) {
    final path = <String>[];
    bool walk(WidgetNode n) {
      if (n.id == targetId) return true;
      path.add(n.className);
      for (final c in n.children) {
        if (walk(c)) return true;
      }
      path.removeLast();
      return false;
    }

    walk(root);
    return path;
  }
}
