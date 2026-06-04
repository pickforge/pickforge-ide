import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/rebuild_stats_decoder.dart';
import 'package:vm_service/vm_service.dart';

void main() {
  test('decodes rebuild events with new locations', () {
    final decoder = RebuildStatsDecoder();

    final stats = decoder.decode(
      Event(
        extensionKind: 'Flutter.RebuiltWidgets',
        extensionData: ExtensionData.parse({
          'frameNumber': 42,
          'startTime': 1000,
          'events': [1, 2, 2, 5],
          'locations': {
            '/app/lib/main.dart': {
              'ids': [1, 2],
              'lines': [10, 20],
              'columns': [4, 8],
              'names': ['Shell', 'CounterText'],
            },
          },
        }),
      ),
    );

    expect(stats?.frameNumber, 42);
    expect(stats?.widgets.map((w) => w.className), [
      'CounterText',
      'Shell',
    ]);
    expect(stats?.widgets.first.count, 5);
    expect(stats?.widgets.first.location.line, 20);
  });

  test('uses remembered locations for compact follow-up events', () {
    final decoder = RebuildStatsDecoder();

    expect(
      decoder.decode(
        Event(
          extensionKind: 'Flutter.RebuiltWidgets',
          extensionData: ExtensionData.parse({
            'events': [7, 1],
            'locations': {
              '/app/lib/counter.dart': {
                'ids': [7],
                'lines': [12],
                'columns': [10],
                'names': ['Counter'],
              },
            },
          }),
        ),
      ),
      isNotNull,
    );

    final stats = decoder.decode(
      Event(
        extensionKind: 'Flutter.RebuiltWidgets',
        extensionData: ExtensionData.parse({
          'events': [7, 3],
        }),
      ),
    );

    expect(stats?.widgets.single.className, 'Counter');
    expect(stats?.widgets.single.count, 3);
  });

  test('ignores unrelated extension events', () {
    final decoder = RebuildStatsDecoder();

    final stats = decoder.decode(
      Event(
        extensionKind: 'Flutter.OtherEvent',
        extensionData: ExtensionData.parse({
          'events': [1, 1],
        }),
      ),
    );

    expect(stats, isNull);
  });
}
