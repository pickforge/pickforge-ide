import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';
import 'package:pickforge/core/targets/react_native/react_native_uiautomator_parser.dart';

const _loginXml = '''
<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout"
        package="com.demo" content-desc="" clickable="false" enabled="true"
        selected="false" bounds="[0,0][1080,2400]">
    <node index="0" text="Welcome" resource-id="com.demo:id/title"
          class="android.widget.TextView" content-desc="" clickable="false"
          enabled="true" selected="false" bounds="[40,200][1040,300]" />
    <node index="1" text="" resource-id="com.demo:id/email"
          class="android.widget.EditText" content-desc="Email field"
          clickable="true" enabled="true" selected="false"
          bounds="[40,400][1040,520]" />
    <node index="2" text="Log in" resource-id="com.demo:id/login"
          class="android.widget.Button" content-desc="" clickable="true"
          enabled="true" selected="true" bounds="[40,600][1040,720]" />
  </node>
</hierarchy>
''';

void main() {
  const parser = ReactNativeUiAutomatorParser();

  test('parses the tree with roles, fields, bounds and flags', () {
    final root = parser.parse(_loginXml);

    expect(root.nodeId, '0');
    expect(root.className, 'android.widget.FrameLayout');
    expect(root.role, ReactNativeA11yRole.unknown);
    expect(root.bounds, const Rect.fromLTRB(0, 0, 1080, 2400));
    expect(root.children, hasLength(3));

    final title = root.children[0];
    expect(title.nodeId, '0/0');
    expect(title.role, ReactNativeA11yRole.text);
    expect(title.text, 'Welcome');
    expect(title.resourceId, 'com.demo:id/title');
    expect(title.contentDescription, isNull);

    final email = root.children[1];
    expect(email.role, ReactNativeA11yRole.input);
    expect(email.text, isNull);
    expect(email.contentDescription, 'Email field');
    expect(email.clickable, isTrue);

    final login = root.children[2];
    expect(login.nodeId, '0/2');
    expect(login.role, ReactNativeA11yRole.button);
    expect(login.text, 'Log in');
    expect(login.selected, isTrue);
    expect(login.bounds, const Rect.fromLTRB(40, 600, 1040, 720));
  });

  test('hitTest returns the deepest node under a point', () {
    final root = parser.parse(_loginXml);
    expect(parser.hitTest(root, const Offset(500, 660))?.nodeId, '0/2');
    expect(parser.hitTest(root, const Offset(500, 250))?.nodeId, '0/0');
    // Inside the root frame but not on any child.
    expect(parser.hitTest(root, const Offset(10, 10))?.nodeId, '0');
    // Outside everything.
    expect(parser.hitTest(root, const Offset(5000, 5000)), isNull);
  });

  test('ancestorHierarchy returns root-to-parent, exclusive of the node', () {
    final root = parser.parse(_loginXml);
    expect(
      parser.ancestorHierarchy(root, '0/2').map((n) => n.nodeId),
      ['0'],
    );
    expect(parser.ancestorHierarchy(root, '0'), isEmpty);
    expect(parser.ancestorHierarchy(root, 'missing'), isEmpty);
  });

  test('malformed bounds fall back to Rect.zero without crashing', () {
    const xml = '''
<hierarchy>
  <node index="0" class="android.view.View" bounds="not-bounds"
        enabled="true" clickable="false" selected="false" />
</hierarchy>
''';
    expect(parser.parse(xml).bounds, Rect.zero);
  });

  test('tolerates leading and trailing dump noise', () {
    const noisy = 'UI hierarchy dumped to: /dev/tty\n$_loginXml\n'
        'UI hierarchy dumped to: /dev/tty';
    expect(parser.parse(noisy).children, hasLength(3));
  });

  test('throws FormatException when there are no node elements', () {
    expect(
      () => parser.parse('<hierarchy rotation="0"></hierarchy>'),
      throwsFormatException,
    );
  });

  test('wraps multiple top-level windows under a hit-testable synthetic root',
      () {
    const multi = '''
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" enabled="true"
        clickable="false" selected="false" bounds="[0,0][500,500]">
    <node index="0" text="Left" class="android.widget.Button" enabled="true"
          clickable="true" selected="false" bounds="[10,10][100,100]" />
  </node>
  <node index="1" class="android.widget.FrameLayout" enabled="true"
        clickable="false" selected="false" bounds="[500,0][1000,500]">
    <node index="0" text="Right" class="android.widget.Button" enabled="true"
          clickable="true" selected="false" bounds="[600,10][700,100]" />
  </node>
</hierarchy>
''';
    final root = parser.parse(multi);
    expect(root.nodeId, 'root');
    expect(root.bounds, const Rect.fromLTRB(0, 0, 1000, 500));
    expect(root.children, hasLength(2));
    expect(parser.hitTest(root, const Offset(50, 50))?.text, 'Left');
    expect(parser.hitTest(root, const Offset(650, 50))?.text, 'Right');
  });

  test('a zero-bounds top window does not skew the synthetic root union', () {
    const multi = '''
<hierarchy rotation="0">
  <node index="0" class="android.widget.FrameLayout" enabled="true"
        clickable="false" selected="false" bounds="[0,0][0,0]" />
  <node index="1" class="android.widget.FrameLayout" enabled="true"
        clickable="false" selected="false" bounds="[400,400][900,900]">
    <node index="0" text="Only" class="android.widget.Button" enabled="true"
          clickable="true" selected="false" bounds="[450,450][550,550]" />
  </node>
</hierarchy>
''';
    final root = parser.parse(multi);
    expect(root.bounds, const Rect.fromLTRB(400, 400, 900, 900));
    expect(parser.hitTest(root, const Offset(500, 500))?.text, 'Only');
    // A point near the origin is outside the real window — no false hit.
    expect(parser.hitTest(root, const Offset(10, 10)), isNull);
  });

  test('infers button role for ImageButton (button wins over image)', () {
    const xml = '''
<hierarchy>
  <node index="0" class="android.widget.ImageButton" content-desc="Send"
        enabled="true" clickable="true" selected="false"
        bounds="[0,0][80,80]" />
</hierarchy>
''';
    expect(parser.parse(xml).role, ReactNativeA11yRole.button);
  });

  test('decodes XML entity escapes in text', () {
    const xml = '''
<hierarchy>
  <node index="0" text="Tom &amp; Jerry &lt;3" class="android.widget.TextView"
        enabled="true" clickable="false" selected="false"
        bounds="[0,0][100,40]" />
</hierarchy>
''';
    expect(parser.parse(xml).text, 'Tom & Jerry <3');
  });
}
