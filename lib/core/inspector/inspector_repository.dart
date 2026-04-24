import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/inspector/widget_tree_decoder.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';

class InspectorRepository {
  InspectorRepository(this._ext, this._source);

  final InspectorExtensions _ext;
  final SourceSnippetExtractor _source;

  Future<void> enableSelectMode() => _ext.setSelectMode(enabled: true);
  Future<void> disableSelectMode() => _ext.setSelectMode(enabled: false);

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
        : await _source.extract(node.creationLocation!);

    return SelectedWidget(
      node: node,
      ancestorClasses: ancestorClasses,
      sourceSnippet: snippet,
      screenshotPath: null,
      adbScreenshotPath: null,
      propertiesJson: rawSelected,
    );
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
