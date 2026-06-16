import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/native_ios/ios_simulator_list_parser.dart';

const _json = '''
{
  "devices": {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-0": [
      {"udid": "AAA", "name": "iPhone 15", "state": "Booted",
       "isAvailable": true},
      {"udid": "BBB", "name": "iPhone 15 Pro", "state": "Shutdown",
       "isAvailable": true}
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-16-4": [
      {"udid": "CCC", "name": "iPad", "state": "Shutdown",
       "isAvailable": false}
    ]
  }
}
''';

void main() {
  const parser = IosSimulatorListParser();

  test('parses simulators with runtime, state and availability', () {
    final sims = parser.parse(_json);
    expect(sims, hasLength(3));

    final booted = sims.firstWhere((s) => s.udid == 'AAA');
    expect(booted.name, 'iPhone 15');
    expect(booted.runtime, 'iOS-17-0');
    expect(booted.isBooted, isTrue);
    expect(booted.isAvailable, isTrue);

    final ipad = sims.firstWhere((s) => s.udid == 'CCC');
    expect(ipad.runtime, 'iOS-16-4');
    expect(ipad.isBooted, isFalse);
    expect(ipad.isAvailable, isFalse);
  });

  test('skips entries without a udid or name', () {
    const json = '''
{"devices": {"rt": [{"state": "Booted"}, {"udid": "X", "name": "Y",
 "state": "Booted", "isAvailable": true}]}}''';
    final sims = parser.parse(json);
    expect(sims, hasLength(1));
    expect(sims.single.udid, 'X');
  });

  test('returns empty for malformed or unexpected JSON', () {
    expect(parser.parse('not json'), isEmpty);
    expect(parser.parse('[]'), isEmpty);
    expect(parser.parse('{"devices": []}'), isEmpty);
    expect(parser.parse('{}'), isEmpty);
  });
}
