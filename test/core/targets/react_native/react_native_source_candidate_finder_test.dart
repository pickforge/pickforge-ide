import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/react_native/react_native_source_candidate_finder.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';

ReactNativeA11yNode _node({
  String? resourceId = 'com.demo:id/login',
  String? text = 'Log in',
  String? contentDescription = 'Sign in',
}) {
  return ReactNativeA11yNode(
    nodeId: '0/1',
    role: ReactNativeA11yRole.button,
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
  final dir = await Directory.systemTemp.createTemp('rn_src');
  await File(p.join(dir.path, 'App.tsx')).writeAsString(
    'export default () => <Button testID="login">\n'
    '  <Text>Log in</Text>\n'
    '</Button>;\n',
  );
  final src = Directory(p.join(dir.path, 'src'))..createSync();
  await File(p.join(src.path, 'LoginButton.tsx')).writeAsString(
    'export const LoginButton = () =>\n'
    '  <Pressable accessibilityLabel="Sign in" />;\n',
  );
  final nodeModules = Directory(p.join(dir.path, 'node_modules', 'rn'))
    ..createSync(recursive: true);
  await File(p.join(nodeModules.path, 'index.js'))
      .writeAsString('// login Sign in Log in noise\n');
  return dir;
}

void main() {
  const finder = ReactNativeSourceCandidateFinder();

  test('ranks resource-id above text and skips node_modules', () async {
    final dir = await _project();
    addTearDown(() => dir.delete(recursive: true));

    final candidates =
        await finder.find(projectRoot: dir.path, selectedNode: _node());

    expect(candidates, isNotEmpty);
    expect(
      candidates.any((c) => c.path.contains('node_modules')),
      isFalse,
    );
    // Highest confidence first.
    expect(candidates.first.path, 'App.tsx');
    expect(candidates.first.confidence, ReactNativeSourceConfidence.high);
    expect(candidates.first.signal, ReactNativeSourceSignal.resourceId);
    expect(candidates.first.matchedValue, 'login');

    // Accessibility label match in the nested file.
    expect(
      candidates.any(
        (c) =>
            c.path == p.join('src', 'LoginButton.tsx') &&
            c.signal == ReactNativeSourceSignal.contentDescription,
      ),
      isTrue,
    );
    // Confidence ordering: high before low.
    final confidences = candidates.map((c) => c.confidence.index).toList();
    final sorted = [...confidences]..sort();
    expect(confidences, sorted);
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

  test('matches on word boundaries, not inside larger identifiers', () async {
    final dir = await Directory.systemTemp.createTemp('rn_src_wb');
    addTearDown(() => dir.delete(recursive: true));
    // Only appears as part of a larger identifier — must NOT match.
    await File(p.join(dir.path, 'Decoy.tsx'))
        .writeAsString('const loginButtonHandler = () => {};\n');
    // A real quoted testID — must match.
    await File(p.join(dir.path, 'Real.tsx'))
        .writeAsString('<Button testID="login" />\n');

    final candidates = await finder.find(
      projectRoot: dir.path,
      selectedNode: _node(text: null, contentDescription: null),
    );
    expect(candidates.map((c) => c.path), ['Real.tsx']);
  });

  test('ignores signals shorter than the minimum length', () async {
    final dir = await Directory.systemTemp.createTemp('rn_src_short');
    addTearDown(() => dir.delete(recursive: true));
    await File(p.join(dir.path, 'Noise.tsx'))
        .writeAsString('const id = 1; // ok\n');

    final candidates = await finder.find(
      projectRoot: dir.path,
      selectedNode: _node(
        resourceId: 'com.demo:id/id',
        text: 'ok',
        contentDescription: null,
      ),
    );
    expect(candidates, isEmpty);
  });

  test('strips the android package prefix from resource ids', () async {
    final dir = await Directory.systemTemp.createTemp('rn_src_bare');
    addTearDown(() => dir.delete(recursive: true));
    await File(p.join(dir.path, 'Widget.tsx'))
        .writeAsString('<View testID="submit" />\n');

    final candidates = await finder.find(
      projectRoot: dir.path,
      selectedNode: _node(
        resourceId: 'com.app:id/submit',
        text: null,
        contentDescription: null,
      ),
    );
    expect(candidates.single.path, 'Widget.tsx');
    expect(candidates.single.matchedValue, 'submit');
  });
}
