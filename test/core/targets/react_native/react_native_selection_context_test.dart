import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/react_native/react_native_selection_context.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';

ReactNativeA11yNode _node({String? text = 'Log in'}) => ReactNativeA11yNode(
      nodeId: '0/2',
      role: ReactNativeA11yRole.button,
      className: 'android.widget.Button',
      text: text,
      contentDescription: 'Sign in',
      resourceId: 'com.demo:id/login',
      bounds: const Rect.fromLTRB(40, 600, 1040, 720),
      enabled: true,
      clickable: true,
      selected: true,
    );

void main() {
  const builder = ReactNativeSelectionContextBuilder();

  test('builds an honest context with null sourcePath and a disclaimer',
      () async {
    final dir = await Directory.systemTemp.createTemp('rn_ctx');
    addTearDown(() => dir.delete(recursive: true));
    await File(p.join(dir.path, 'App.tsx'))
        .writeAsString('<Button testID="login" />\n');

    final context = await builder.build(
      projectRoot: dir.path,
      selectedNode: _node(),
      screenshotPath: '/ctx/device-screen.png',
      ancestorHierarchy: const [
        ReactNativeA11yNode(
          nodeId: '0',
          role: ReactNativeA11yRole.unknown,
          className: 'android.widget.FrameLayout',
          bounds: Rect.zero,
          enabled: true,
          clickable: false,
          selected: false,
        ),
      ],
      metroLogLines: const ['info ready', 'warn slow'],
      logcatLines: const ['I/RN: hello'],
    );

    // STOP condition (b): no exact source mapping is claimed.
    expect(context.targetSelection.sourcePath, isNull);
    expect(context.targetSelection.sourceLine, isNull);
    expect(context.targetSelection.label, 'Log in');
    expect(context.targetSelection.screenshotPath, '/ctx/device-screen.png');
    expect(context.disclaimer, contains('not available'));

    final props = jsonDecode(context.targetSelection.propertiesJson!)
        as Map<String, Object?>;
    expect(props['disclaimer'], contains('not available'));
    expect(props['likelySourceFiles'], isNotEmpty);

    expect(context.likelySourceFiles.first.path, 'App.tsx');
    expect(context.logExcerpts.map((e) => e.source), ['metro', 'logcat']);
  });

  test('label falls back to className when there is no text or label',
      () async {
    final dir = await Directory.systemTemp.createTemp('rn_ctx2');
    addTearDown(() => dir.delete(recursive: true));
    const node = ReactNativeA11yNode(
      nodeId: '0',
      role: ReactNativeA11yRole.unknown,
      className: 'android.view.View',
      bounds: Rect.zero,
      enabled: true,
      clickable: false,
      selected: false,
    );

    final context = await builder.build(
      projectRoot: dir.path,
      selectedNode: node,
    );
    expect(context.targetSelection.label, 'android.view.View');
    expect(context.logExcerpts, isEmpty);
  });

  test('toJson exposes node, ancestors, candidates, logs and disclaimer',
      () async {
    final dir = await Directory.systemTemp.createTemp('rn_ctx3');
    addTearDown(() => dir.delete(recursive: true));

    final context = await builder.build(
      projectRoot: dir.path,
      selectedNode: _node(),
      logcatLines: const ['E/RN: boom'],
    );
    final json = context.toJson();

    expect((json['selectedNode']! as Map)['resourceId'], 'com.demo:id/login');
    expect(json['logExcerpts'], hasLength(1));
    expect(json['disclaimer'], contains('React'));
    expect(json.containsKey('likelySourceFiles'), isTrue);
  });
}
