import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/android/android_uiautomator_node.dart';
import 'package:pickforge/core/targets/native_android/native_android_source_candidate_finder.dart';

AndroidA11yNode _node({
  String? resourceId = 'com.demo:id/login',
  String? text = 'Log in',
  String? contentDescription = 'Sign in',
}) {
  return AndroidA11yNode(
    nodeId: '0/1',
    role: AndroidA11yRole.button,
    className: 'android.widget.Button',
    text: text,
    contentDescription: contentDescription,
    resourceId: resourceId,
    bounds: const Rect.fromLTRB(0, 0, 100, 50),
    enabled: true,
    clickable: true,
    selected: false,
  );
}

Future<Directory> _project() async {
  final dir = await Directory.systemTemp.createTemp('na_src');
  final layout =
      Directory(p.join(dir.path, 'app', 'src', 'main', 'res', 'layout'))
        ..createSync(recursive: true);
  await File(p.join(layout.path, 'activity_main.xml')).writeAsString(
    '<Button android:id="@+id/login"\n'
    '        android:text="Log in"\n'
    '        android:contentDescription="Sign in" />\n',
  );
  final java = Directory(p.join(dir.path, 'app', 'src', 'main', 'java'))
    ..createSync(recursive: true);
  await File(p.join(java.path, 'MainActivity.kt'))
      .writeAsString('val button = findViewById(R.id.login)\n');
  final build = Directory(p.join(dir.path, 'build', 'generated'))
    ..createSync(recursive: true);
  await File(p.join(build.path, 'Noise.kt'))
      .writeAsString('// login Sign in Log in generated noise\n');
  return dir;
}

void main() {
  const finder = NativeAndroidSourceCandidateFinder();

  test('ranks resource-id high and skips build/ output', () async {
    final dir = await _project();
    addTearDown(() => dir.delete(recursive: true));

    final candidates =
        await finder.find(projectRoot: dir.path, selectedNode: _node());

    expect(candidates, isNotEmpty);
    expect(candidates.any((c) => c.path.contains('build')), isFalse);
    expect(candidates.first.confidence, NativeAndroidSourceConfidence.high);
    expect(candidates.first.signal, NativeAndroidSourceSignal.resourceId);
    expect(candidates.first.matchedValue, 'login');

    final confidences = candidates.map((c) => c.confidence.index).toList();
    final sorted = [...confidences]..sort();
    expect(confidences, sorted);
  });

  test('matches resource ids on word boundaries (@+id, R.id, testTag)',
      () async {
    final dir = await Directory.systemTemp.createTemp('na_src_wb');
    addTearDown(() => dir.delete(recursive: true));
    await File(p.join(dir.path, 'Decoy.kt'))
        .writeAsString('val loginButtonHandler = 1\n');
    await File(p.join(dir.path, 'Compose.kt'))
        .writeAsString('Modifier.testTag("login")\n');

    final candidates = await finder.find(
      projectRoot: dir.path,
      selectedNode: _node(text: null, contentDescription: null),
    );
    expect(candidates.map((c) => c.path), ['Compose.kt']);
  });

  test('emits one candidate per file with no duplicate paths', () async {
    final dir = await _project();
    addTearDown(() => dir.delete(recursive: true));
    // activity_main.xml carries id + text + contentDescription, but yields a
    // single (highest-confidence) candidate.
    final candidates =
        await finder.find(projectRoot: dir.path, selectedNode: _node());
    final paths = candidates.map((c) => c.path).toList();
    expect(paths.toSet().length, paths.length);
  });

  test('caps AFTER sorting so a late high-confidence match survives', () async {
    final dir = await Directory.systemTemp.createTemp('na_src_cap');
    addTearDown(() => dir.delete(recursive: true));
    // Three low-confidence (text) files come first in traversal...
    for (var i = 0; i < 3; i++) {
      await File(p.join(dir.path, 'a_text_$i.kt'))
          .writeAsString('val s = "Log in"\n');
    }
    // ...and one high-confidence (resource-id) file comes last.
    await File(p.join(dir.path, 'z_high.kt'))
        .writeAsString('val v = R.id.login\n');

    const capped = NativeAndroidSourceCandidateFinder(maxCandidates: 2);
    final candidates =
        await capped.find(projectRoot: dir.path, selectedNode: _node());

    expect(candidates, hasLength(2));
    expect(candidates.first.confidence, NativeAndroidSourceConfidence.high);
    expect(candidates.first.path, 'z_high.kt');
  });

  test('returns nothing when the node exposes no searchable signals', () async {
    final dir = await _project();
    addTearDown(() => dir.delete(recursive: true));
    final candidates = await finder.find(
      projectRoot: dir.path,
      selectedNode:
          _node(resourceId: null, text: null, contentDescription: null),
    );
    expect(candidates, isEmpty);
  });
}
