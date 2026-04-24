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

  test('throws when methods are replayed out of order', () async {
    final script = await FakeVmServiceScript.loadFromFile(
      'test/fixtures/vm_service/connect_and_select_button.jsonl',
    );
    expect(
      () => script.respondTo('ext.flutter.inspector.show'),
      throwsStateError,
    );
  });

  test('supports request entries in recorded fixtures', () {
    final script = FakeVmServiceScript([
      {'type': 'request', 'method': 'getVM', 'params': <String, dynamic>{}},
      {
        'type': 'response',
        'method': 'getVM',
        'result': {'name': 'flutter'},
      },
    ]);

    expect(script.respondTo('getVM')['name'], 'flutter');
  });

  test('matches request and response entries by id', () {
    final script = FakeVmServiceScript([
      {
        'type': 'request',
        'method': 'getVM',
        'params': <String, dynamic>{},
        'id': '1',
      },
      {
        'type': 'response',
        'id': '1',
        'result': {'name': 'flutter'},
      },
    ]);

    expect(script.respondTo('getVM')['name'], 'flutter');
  });

  test('allows events between a recorded request and response', () {
    final script = FakeVmServiceScript([
      {
        'type': 'request',
        'method': 'getVM',
        'params': <String, dynamic>{},
        'id': '1',
      },
      {'type': 'event', 'streamId': 'Extension'},
      {
        'type': 'response',
        'id': '1',
        'result': {'name': 'flutter'},
      },
    ]);

    expect(script.respondTo('getVM')['name'], 'flutter');
  });

  test('requires event entries to be consumed in order', () {
    final script = FakeVmServiceScript([
      {'type': 'event', 'streamId': 'Extension'},
      {
        'type': 'response',
        'method': 'getVM',
        'result': {'name': 'flutter'},
      },
    ]);

    expect(() => script.respondTo('getVM'), throwsStateError);
    expect(script.consumeEvent('Extension')['streamId'], 'Extension');
    expect(script.respondTo('getVM')['name'], 'flutter');
  });

  test('failed event consumption does not advance the script', () {
    final script = FakeVmServiceScript([
      {'type': 'event', 'streamId': 'Extension'},
    ]);

    expect(() => script.consumeEvent('Wrong'), throwsStateError);
    expect(script.consumeEvent('Extension')['streamId'], 'Extension');
  });
}
