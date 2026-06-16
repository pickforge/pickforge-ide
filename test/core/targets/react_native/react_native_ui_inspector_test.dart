import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/targets/react_native/react_native_adb_service.dart';
import 'package:pickforge/core/targets/react_native/react_native_ui_inspector.dart';

class _FakeAdb extends Mock implements ReactNativeAdbService {}

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
  late _FakeAdb adb;

  setUp(() => adb = _FakeAdb());

  test('inspect parses the dumped hierarchy', () async {
    when(() => adb.dumpUiAutomatorXml(serial: 'emulator-5554'))
        .thenAnswer((_) async => _xml);

    final root = await ReactNativeUiInspector(adb).inspect(
      serial: 'emulator-5554',
    );
    expect(root, isNotNull);
    expect(root!.children.single.text, 'Log in');
  });

  test('selectedAt hit-tests against the dumped hierarchy', () async {
    when(() => adb.dumpUiAutomatorXml(serial: any(named: 'serial')))
        .thenAnswer((_) async => _xml);

    final node = await ReactNativeUiInspector(adb).selectedAt(
      serial: 'emulator-5554',
      devicePoint: const Offset(500, 660),
    );
    expect(node?.resourceId, 'com.demo:id/login');
  });

  test('inspect returns null when the dump is unavailable', () async {
    when(() => adb.dumpUiAutomatorXml(serial: any(named: 'serial')))
        .thenAnswer((_) async => null);
    expect(
      await ReactNativeUiInspector(adb).inspect(serial: 's'),
      isNull,
    );
  });

  test('inspect returns null for an unparseable dump', () async {
    when(() => adb.dumpUiAutomatorXml(serial: any(named: 'serial')))
        .thenAnswer((_) async => '<hierarchy></hierarchy>');
    expect(
      await ReactNativeUiInspector(adb).inspect(serial: 's'),
      isNull,
    );
  });
}
