import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';
import 'package:vm_service/vm_service.dart';

class _MockVmService extends Mock implements VmService {}

class _FakeResponse extends Fake implements Response {
  _FakeResponse(this._data);

  final Map<String, dynamic> _data;

  @override
  Map<String, dynamic> get json => _data;
}

void main() {
  late _MockVmService vm;
  late InspectorExtensions ext;

  setUp(() {
    vm = _MockVmService();
    ext = InspectorExtensions(vm, isolateId: 'isolates/1');
  });

  test('setSelectMode calls ext.flutter.inspector.show with enabled=true',
      () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'enabled': true}));

    await ext.setSelectMode(enabled: true);

    verify(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    ).called(1);
  });

  test('setTrackRebuildDirtyWidgets calls inspector extension', () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.trackRebuildDirtyWidgets',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'enabled': true}));

    await ext.setTrackRebuildDirtyWidgets(enabled: true);

    verify(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.trackRebuildDirtyWidgets',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    ).called(1);
  });

  test('listenToExtensionEvents subscribes to the extension stream', () async {
    when(() => vm.streamListen(EventStreams.kExtension))
        .thenAnswer((_) async => Success());

    await ext.listenToExtensionEvents();

    verify(() => vm.streamListen(EventStreams.kExtension)).called(1);
  });

  test('listenToExtensionEvents ignores already subscribed error', () async {
    when(() => vm.streamListen(EventStreams.kExtension)).thenThrow(
      RPCError('streamListen', RPCErrorKind.kStreamAlreadySubscribed.code),
    );

    await ext.listenToExtensionEvents();

    verify(() => vm.streamListen(EventStreams.kExtension)).called(1);
  });

  test('watchRebuiltWidgets decodes Flutter rebuild events', () async {
    final controller = StreamController<Event>();
    addTearDown(controller.close);
    when(() => vm.onExtensionEvent).thenAnswer((_) => controller.stream);

    final expectStats = expectLater(
      ext.watchRebuiltWidgets(),
      emits(
        predicate<RebuildStats>(
          (stats) =>
              stats.widgets.single.className == 'Counter' &&
              stats.widgets.single.count == 4,
        ),
      ),
    );

    controller.add(
      Event(
        extensionKind: 'Flutter.RebuiltWidgets',
        extensionData: ExtensionData.parse({
          'events': [9, 4],
          'locations': {
            '/app/lib/main.dart': {
              'ids': [9],
              'lines': [21],
              'columns': [6],
              'names': ['Counter'],
            },
          },
        }),
      ),
    );

    await expectStats;
  });

  test('getSelectedWidget requests an object group and returns response json',
      () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.getSelectedWidget',
        isolateId: 'isolates/1',
        args: {'objectGroup': 'pickforge'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'description': 'Text'}));

    final selected = await ext.getSelectedWidget();

    expect(selected?['description'], 'Text');
  });

  test('getSelectedWidget unwraps service-extension result envelope', () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.getSelectedWidget',
        isolateId: 'isolates/1',
        args: {'objectGroup': 'pickforge'},
      ),
    ).thenAnswer(
      (_) async => _FakeResponse({
        'result': {'description': 'Text', 'valueId': 'w1'},
      }),
    );

    final selected = await ext.getSelectedWidget();

    expect(selected?['valueId'], 'w1');
  });

  test('getSelectedWidget returns null for empty result envelope', () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.getSelectedWidget',
        isolateId: 'isolates/1',
        args: {'objectGroup': 'pickforge'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'result': null}));

    final selected = await ext.getSelectedWidget();

    expect(selected, isNull);
  });

  test('getRootWidgetSummaryTree returns response json', () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.getRootWidgetSummaryTree',
        isolateId: 'isolates/1',
        args: {'objectGroup': 'pickforge'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'description': 'Root'}));

    final tree = await ext.getRootWidgetSummaryTree();

    expect(tree?['description'], 'Root');
  });

  test('screenshot decodes base64 bytes', () async {
    when(
      () => vm.callServiceExtension(
        'ext.flutter.inspector.screenshot',
        isolateId: 'isolates/1',
        args: {
          'id': 'w1',
          'width': '480.0',
          'height': '480.0',
          'margin': '16.0',
          'maxPixelRatio': '2.0',
          'debugPaint': 'false',
        },
      ),
    ).thenAnswer(
      (_) async => _FakeResponse({
        'result': base64.encode([1, 2]),
      }),
    );

    final bytes = await ext.screenshot(
      id: 'w1',
      width: 480,
      height: 480,
      margin: 16,
      maxPixelRatio: 2,
    );

    expect(bytes, [1, 2]);
  });
}
