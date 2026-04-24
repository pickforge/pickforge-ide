import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
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
      ),
    ).thenAnswer(
      (_) async => _FakeResponse({
        'screenshot': base64.encode([1, 2]),
      }),
    );

    final bytes = await ext.screenshot();

    expect(bytes, [1, 2]);
  });
}
