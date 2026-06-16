import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/react_native/react_native_context_renderer.dart';
import 'package:pickforge/core/targets/react_native/react_native_selection_context.dart';
import 'package:pickforge/core/targets/react_native/react_native_source_candidate_finder.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';
import 'package:pickforge/core/targets/target_selection.dart';

ReactNativeA11yNode _node(String id, String className, {String? resourceId}) =>
    ReactNativeA11yNode(
      nodeId: id,
      role: ReactNativeA11yRole.button,
      className: className,
      resourceId: resourceId,
      bounds: Rect.zero,
      enabled: true,
      clickable: true,
      selected: false,
    );

void main() {
  const renderer = ReactNativeContextRenderer();

  ReactNativeSelectionContext context() {
    return ReactNativeSelectionContext(
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
        ReactNativeSourceCandidate(
          path: 'App.tsx',
          line: 12,
          confidence: ReactNativeSourceConfidence.high,
          signal: ReactNativeSourceSignal.resourceId,
          matchedValue: 'login',
        ),
      ],
      logExcerpts: const [
        ReactNativeLogExcerpt(source: 'metro', lines: ['info ready']),
      ],
      disclaimer: ReactNativeSelectionContextBuilder.disclaimer,
    );
  }

  test('renders the useful-support header and the disclaimer', () {
    final markdown = renderer.render(context());
    expect(markdown, contains('React Native Android — useful support'));
    expect(markdown, contains('not available for React Native'));
  });

  test('renders likely files, ancestors, screenshot and logs', () {
    final markdown = renderer.render(context());
    expect(markdown, contains('App.tsx:12'));
    expect(markdown, contains('high confidence'));
    expect(markdown, contains('Ancestors (root → parent)'));
    expect(markdown, contains('/ctx/device-screen.png'));
    expect(markdown, contains('## metro log (recent)'));
    expect(markdown, contains('info ready'));
  });

  test('fences log output so backticks in a line cannot break out', () {
    final ctx = ReactNativeSelectionContext(
      targetSelection: const TargetSelection(id: '0', label: 'View'),
      selectedNode: _node('0', 'android.view.View'),
      ancestorHierarchy: const [],
      likelySourceFiles: const [],
      logExcerpts: const [
        ReactNativeLogExcerpt(
          source: 'logcat',
          lines: ['normal line', 'evil ``` fence', 'after'],
        ),
      ],
      disclaimer: ReactNativeSelectionContextBuilder.disclaimer,
    );
    final markdown = renderer.render(ctx);
    // The opening fence must be longer than the 3-backtick run in the content.
    expect(markdown, contains('````'));
    expect(markdown, contains('evil ``` fence'));
  });

  test('renders a clear note when no source files are found', () {
    final empty = ReactNativeSelectionContext(
      targetSelection: const TargetSelection(id: '0', label: 'View'),
      selectedNode: _node('0', 'android.view.View'),
      ancestorHierarchy: const [],
      likelySourceFiles: const [],
      logExcerpts: const [],
      disclaimer: ReactNativeSelectionContextBuilder.disclaimer,
    );
    expect(renderer.render(empty), contains('None found.'));
  });
}
