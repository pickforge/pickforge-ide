import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/android/android_uiautomator_node.dart';
import 'package:pickforge/core/targets/native_android/native_android_selection_context.dart';

AndroidA11yNode _node({String? text = 'Log in'}) => AndroidA11yNode(
      nodeId: '0/2',
      role: AndroidA11yRole.button,
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
  const builder = NativeAndroidSelectionContextBuilder();

  test('builds an honest context with null sourcePath and a disclaimer',
      () async {
    final dir = await Directory.systemTemp.createTemp('na_ctx');
    addTearDown(() => dir.delete(recursive: true));
    await File(p.join(dir.path, 'activity_main.xml'))
        .writeAsString('<Button android:id="@+id/login" />\n');

    final context = await builder.build(
      projectRoot: dir.path,
      selectedNode: _node(),
      screenshotPath: '/ctx/device-screen.png',
      logcatLines: const ['I/RN: hello'],
    );

    expect(context.targetSelection.sourcePath, isNull);
    expect(context.targetSelection.sourceLine, isNull);
    expect(context.targetSelection.label, 'Log in');
    expect(context.targetSelection.screenshotPath, '/ctx/device-screen.png');
    expect(context.disclaimer, contains('not available'));

    final props = jsonDecode(context.targetSelection.propertiesJson!)
        as Map<String, Object?>;
    expect(props['disclaimer'], contains('not available'));
    expect(props['likelySourceFiles'], isNotEmpty);
    expect(context.likelySourceFiles.first.path, 'activity_main.xml');
    expect(context.logcatExcerpt, ['I/RN: hello']);
  });

  test('label falls back to className; logcat tail capped at 20', () async {
    final dir = await Directory.systemTemp.createTemp('na_ctx2');
    addTearDown(() => dir.delete(recursive: true));
    const node = AndroidA11yNode(
      nodeId: '0',
      role: AndroidA11yRole.unknown,
      className: 'android.view.View',
      bounds: Rect.zero,
      enabled: true,
      clickable: false,
      selected: false,
    );

    final context = await builder.build(
      projectRoot: dir.path,
      selectedNode: node,
      logcatLines: List.generate(30, (i) => 'line $i'),
    );
    expect(context.targetSelection.label, 'android.view.View');
    expect(context.logcatExcerpt, hasLength(20));
    expect(context.logcatExcerpt.first, 'line 10');
  });
}
