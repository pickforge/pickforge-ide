import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/testing/fake_vm_service.dart';

void main() {
  test('loadFromFile replays responses in script order', () async {
    final script = await FakeVmServiceScript.loadFromFile(
      'test/fixtures/vm_service/connect_and_select_button.jsonl',
    );
    expect(script.respondTo('getVM')['name'], 'flutter');
    expect(script.respondTo('ext.flutter.inspector.show')['enabled'], isTrue);
    expect(
      script
          .respondTo('ext.flutter.inspector.getSelectedWidget')['description'],
      'ElevatedButton',
    );
  });

  test('throws on missing method', () async {
    final script = await FakeVmServiceScript.loadFromFile(
      'test/fixtures/vm_service/connect_and_select_button.jsonl',
    );
    expect(() => script.respondTo('nonexistent'), throwsStateError);
  });
}
