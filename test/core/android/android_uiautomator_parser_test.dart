import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/android/android_uiautomator_node.dart';
import 'package:pickforge/core/android/android_uiautomator_parser.dart';

// The behavior is exhaustively covered by the React Native parser tests (which
// now exercise this shared code through type aliases). This smoke test confirms
// the extracted Android-named public API is usable on its own.
const _xml = '''
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" enabled="true"
        clickable="false" selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="Log in" class="android.widget.Button"
          resource-id="com.demo:id/login" enabled="true" clickable="true"
          selected="false" bounds="[40,600][1040,720]" />
  </node>
</hierarchy>
''';

void main() {
  const parser = AndroidUiAutomatorParser();

  test('parses with the shared Android-named API', () {
    final root = parser.parse(_xml);
    expect(root, isA<AndroidA11yNode>());
    expect(root.className, 'android.widget.FrameLayout');

    final button = root.children.single;
    expect(button.role, AndroidA11yRole.button);
    expect(button.text, 'Log in');
    expect(button.resourceId, 'com.demo:id/login');

    expect(parser.hitTest(root, const Offset(500, 660))?.nodeId, '0/0');
    expect(parser.ancestorHierarchy(root, '0/0').single.nodeId, '0');
  });
}
