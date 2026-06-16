import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/android/android_uiautomator_node.dart';
import 'package:pickforge/core/targets/native_android/native_android_context_renderer.dart';
import 'package:pickforge/core/targets/native_android/native_android_selection_context.dart';
import 'package:pickforge/core/targets/native_android/native_android_source_candidate_finder.dart';
import 'package:pickforge/core/targets/target_selection.dart';

AndroidA11yNode _node(String id, String className, {String? resourceId}) =>
    AndroidA11yNode(
      nodeId: id,
      role: AndroidA11yRole.button,
      className: className,
      resourceId: resourceId,
      bounds: Rect.zero,
      enabled: true,
      clickable: true,
      selected: false,
    );

void main() {
  const renderer = NativeAndroidContextRenderer();

  NativeAndroidSelectionContext context({List<String> logcat = const []}) {
    return NativeAndroidSelectionContext(
      targetSelection: const TargetSelection(
        id: '0/2',
        label: 'Log in',
        screenshotPath: '/ctx/device-screen.png',
      ),
      selectedNode: _node(
        '0/2',
        'android.widget.Button',
        resourceId: 'com.demo:id/login',
      ),
      ancestorHierarchy: [_node('0', 'android.widget.FrameLayout')],
      likelySourceFiles: const [
        NativeAndroidSourceCandidate(
          path: 'app/src/main/res/layout/activity_main.xml',
          line: 7,
          confidence: NativeAndroidSourceConfidence.high,
          signal: NativeAndroidSourceSignal.resourceId,
          matchedValue: 'login',
        ),
      ],
      logcatExcerpt: logcat,
      disclaimer: NativeAndroidSelectionContextBuilder.disclaimer,
    );
  }

  test('renders the best-effort header, files, ancestors and disclaimer', () {
    final markdown = renderer.render(context());
    expect(markdown, contains('Native Android — best-effort support'));
    expect(markdown, contains('not available'));
    expect(markdown, contains('activity_main.xml:7'));
    expect(markdown, contains('high confidence'));
    expect(markdown, contains('Ancestors (root → parent)'));
    expect(markdown, contains('/ctx/device-screen.png'));
  });

  test('fences logcat so backticks in a line cannot break out', () {
    final markdown =
        renderer.render(context(logcat: ['normal', 'evil ``` fence']));
    expect(markdown, contains('````'));
    expect(markdown, contains('evil ``` fence'));
  });

  test('collapses newlines in inline fields so they cannot inject markdown',
      () {
    const ctx = NativeAndroidSelectionContext(
      targetSelection: TargetSelection(id: '0', label: 'x'),
      selectedNode: AndroidA11yNode(
        nodeId: '0',
        role: AndroidA11yRole.text,
        className: 'android.widget.TextView',
        text: 'first\n## Injected heading',
        bounds: Rect.zero,
        enabled: true,
        clickable: false,
        selected: false,
      ),
      ancestorHierarchy: [],
      likelySourceFiles: [],
      logcatExcerpt: [],
      disclaimer: NativeAndroidSelectionContextBuilder.disclaimer,
    );
    final markdown = renderer.render(ctx);
    expect(markdown, contains('- Text: first ## Injected heading'));
    expect(markdown, isNot(contains('\n## Injected heading')));
  });

  test('notes when no source files are found', () {
    final ctx = NativeAndroidSelectionContext(
      targetSelection: const TargetSelection(id: '0', label: 'View'),
      selectedNode: _node('0', 'android.view.View'),
      ancestorHierarchy: const [],
      likelySourceFiles: const [],
      logcatExcerpt: const [],
      disclaimer: NativeAndroidSelectionContextBuilder.disclaimer,
    );
    expect(renderer.render(ctx), contains('None found.'));
  });
}
