import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';

void main() {
  test('wireName per mode', () {
    expect(const ContextStorageLocation.pickforgeHome().wireName, 'home');
    expect(
      const ContextStorageLocation.projectLocal().wireName,
      'project-local',
    );
    expect(const ContextStorageLocation.custom('/tmp/x').wireName, 'custom');
  });

  test('fromWire round-trips home and project-local', () {
    for (final loc in const [
      ContextStorageLocation.pickforgeHome(),
      ContextStorageLocation.projectLocal(),
    ]) {
      expect(ContextStorageLocation.fromWire(loc.wireName), loc);
    }
  });

  test('fromWire custom round-trips with customPath', () {
    const loc = ContextStorageLocation.custom('/tmp/x');
    expect(
      ContextStorageLocation.fromWire(loc.wireName, customPath: '/tmp/x'),
      loc,
    );
  });

  test('fromWire custom with null customPath returns null', () {
    expect(ContextStorageLocation.fromWire('custom'), isNull);
  });

  test('fromWire garbage returns null', () {
    expect(ContextStorageLocation.fromWire('garbage'), isNull);
    expect(ContextStorageLocation.fromWire(null), isNull);
  });

  test('equality', () {
    expect(
      const ContextStorageLocation.pickforgeHome(),
      const ContextStorageLocation.pickforgeHome(),
    );
    expect(
      const ContextStorageLocation.custom('/a'),
      const ContextStorageLocation.custom('/a'),
    );
    expect(
      const ContextStorageLocation.custom('/a'),
      isNot(const ContextStorageLocation.custom('/b')),
    );
    expect(
      const ContextStorageLocation.pickforgeHome(),
      isNot(const ContextStorageLocation.projectLocal()),
    );
  });
}
