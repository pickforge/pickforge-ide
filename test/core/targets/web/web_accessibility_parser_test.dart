import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/web/web_accessibility_parser.dart';

// A trimmed CDP Accessibility.getFullAXTree payload.
const _axTree = '''
{
  "nodes": [
    {"nodeId": "1", "ignored": false, "role": {"value": "RootWebArea"},
     "name": {"value": "Vite App"}, "childIds": ["2"], "backendDOMNodeId": 1},
    {"nodeId": "2", "ignored": false, "role": {"value": "main"},
     "childIds": ["3"], "backendDOMNodeId": 4},
    {"nodeId": "3", "ignored": false, "role": {"value": "button"},
     "name": {"value": "Log in"}, "value": {"value": "submit"},
     "childIds": [], "backendDOMNodeId": 7}
  ]
}
''';

void main() {
  const parser = WebAccessibilityParser();

  test('parses the AX tree with role, name, value and DOM backing', () {
    final root = parser.parse(_axTree)!;
    expect(root.nodeId, '1');
    expect(root.role, 'RootWebArea');
    expect(root.name, 'Vite App');

    final button = parser.findById(root, '3')!;
    expect(button.role, 'button');
    expect(button.name, 'Log in');
    expect(button.value, 'submit');
    expect(button.backendDomNodeId, 7);
  });

  test('ancestorPath returns the DOM-ish node path root → parent', () {
    final root = parser.parse(_axTree)!;
    expect(
      parser.ancestorPath(root, '3').map((n) => n.role),
      ['RootWebArea', 'main'],
    );
    expect(parser.ancestorPath(root, '1'), isEmpty);
  });

  test('tolerates malformed JSON, empty nodes, and cycles', () {
    expect(parser.parse('not json'), isNull);
    expect(parser.parse('{"nodes": []}'), isNull);
    expect(parser.parse('{}'), isNull);

    // A cyclic childIds reference must not infinite-loop.
    const cyclic = '''
{"nodes": [
  {"nodeId": "a", "role": {"value": "x"}, "childIds": ["b"]},
  {"nodeId": "b", "role": {"value": "y"}, "childIds": ["a"]}
]}''';
    final root = parser.parse(cyclic)!;
    expect(root.nodeId, 'a');
    expect(root.children.single.nodeId, 'b');
    expect(root.children.single.children, isEmpty); // cycle broken
  });

  test('prefers the RootWebArea when several nodes are unreferenced', () {
    // A forest: two unreferenced nodes. The RootWebArea must win the root slot
    // regardless of declaration order.
    const forest = '''
{"nodes": [
  {"nodeId": "x", "role": {"value": "main"}, "childIds": []},
  {"nodeId": "y", "role": {"value": "RootWebArea"}, "childIds": []}
]}''';
    expect(parser.parse(forest)!.role, 'RootWebArea');
  });

  test('treats a non-list childIds field as no children', () {
    // Real CDP always sends a list; a malformed string must degrade, not throw.
    const malformed = '''
{"nodes": [
  {"nodeId": "1", "role": {"value": "RootWebArea"}, "childIds": "2"}
]}''';
    final root = parser.parse(malformed)!;
    expect(root.children, isEmpty);
  });
}
