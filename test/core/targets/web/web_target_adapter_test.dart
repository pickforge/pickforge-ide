import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/react_native/react_native_target_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';
import 'package:pickforge/core/targets/web/web_project_detector.dart';
import 'package:pickforge/core/targets/web/web_target_adapter.dart';

Future<Directory> _project({
  Map<String, String> deps = const {},
  Map<String, String> scripts = const {},
}) async {
  final dir = await Directory.systemTemp.createTemp('web_project');
  await File(p.join(dir.path, 'package.json')).writeAsString(
    jsonEncode({'dependencies': deps, 'scripts': scripts}),
  );
  return dir;
}

void main() {
  const adapter = WebTargetAdapter();
  const detector = WebProjectDetector();

  group('WebProjectDetector', () {
    test('detects a web framework dependency as exact', () async {
      final dir =
          await _project(deps: {'react-dom': '18.0.0', 'vite': '5.0.0'});
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.hasWebFramework, isTrue);
    });

    test('detects a dev/start script as a softer signal', () async {
      // Note: a backend-only project with a `start` script also matches here at
      // `likely` confidence — an accepted soft-signal limitation of the MVP.
      final dir = await _project(scripts: {'dev': 'serve'});
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.hasWebFramework, isFalse);
      expect(info.devScript, 'dev');
    });

    test('detects a framework declared only in devDependencies', () async {
      final dir = await _project(deps: {}, scripts: {});
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'package.json')).writeAsString(
        jsonEncode({
          'devDependencies': {'vite': '5.0.0'},
        }),
      );
      expect((await detector.detect(dir.path))!.hasWebFramework, isTrue);
    });

    test('does NOT claim a React Native / Expo project', () async {
      final rn = await _project(
        deps: {'react-native': '0.74.0', 'react-dom': '18.0.0'},
        scripts: {'start': 'x'},
      );
      addTearDown(() => rn.delete(recursive: true));
      expect(await detector.detect(rn.path), isNull);

      final expo = await _project(
        deps: {'expo': '51.0.0'},
        scripts: {'start': 'expo start'},
      );
      addTearDown(() => expo.delete(recursive: true));
      expect(await detector.detect(expo.path), isNull);
    });

    test('claims Expo-for-web (expo + a real bundler) but not Expo-mobile',
        () async {
      final web = await _project(deps: {'expo': '51.0.0', 'vite': '5.0.0'});
      addTearDown(() => web.delete(recursive: true));
      expect((await detector.detect(web.path))!.hasWebFramework, isTrue);

      final mobile = await _project(
        deps: {'expo': '51.0.0'},
        scripts: {'start': 'expo start'},
      );
      addTearDown(() => mobile.delete(recursive: true));
      expect(await detector.detect(mobile.path), isNull);
    });

    test('returns null for malformed or non-object package.json', () async {
      final bad = await Directory.systemTemp.createTemp('web_bad');
      addTearDown(() => bad.delete(recursive: true));
      await File(p.join(bad.path, 'package.json')).writeAsString('{invalid');
      expect(await detector.detect(bad.path), isNull);

      final arr = await Directory.systemTemp.createTemp('web_arr');
      addTearDown(() => arr.delete(recursive: true));
      await File(p.join(arr.path, 'package.json')).writeAsString('[]');
      expect(await detector.detect(arr.path), isNull);
    });

    test('prefers the dev script over start', () async {
      final dir = await _project(scripts: {'start': 'x', 'dev': 'y'});
      addTearDown(() => dir.delete(recursive: true));
      expect((await detector.detect(dir.path))!.devScript, 'dev');
    });

    test('returns null for a package.json with no web signal', () async {
      final dir = await _project(deps: {'lodash': '4.0.0'});
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNull);
    });

    test('returns null without a package.json', () async {
      final dir = await Directory.systemTemp.createTemp('not_web');
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNull);
    });
  });

  group('WebTargetAdapter', () {
    test('identity and honest capabilities', () {
      expect(adapter.id, 'web');
      expect(adapter.displayName, 'Web');
      expect(adapter.priority, 50);
      expect(adapter.capabilities.has(TargetCapability.detect), isTrue);
      expect(adapter.capabilities.has(TargetCapability.launch), isTrue); // 8B
      expect(
        adapter.capabilities.has(TargetCapability.mapSelectionToSource),
        isFalse,
      );
    });

    test('detect surfaces web facts in the details', () async {
      final dir = await _project(
        deps: {'next': '14.0.0'},
        scripts: {'dev': 'next dev'},
      );
      addTearDown(() => dir.delete(recursive: true));
      final detection = await adapter.detect(dir.path);
      expect(detection!.targetId, 'web');
      expect(detection.confidence, DetectionConfidence.exact);
      expect(detection.details?['hasWebFramework'], 'true');
      expect(detection.details?['devScript'], 'dev');
    });
  });

  group('in the registry', () {
    final registry = TargetAdapterRegistry(const [
      ReactNativeTargetAdapter(),
      WebTargetAdapter(),
      GenericProjectAdapter(),
    ]);

    test('a web project resolves to the web adapter', () async {
      final dir = await _project(deps: {'react-dom': '18.0.0'});
      addTearDown(() => dir.delete(recursive: true));
      expect((await registry.detectFor(dir.path)).id, 'web');
    });

    test('an Expo root without android/ falls to generic, not web', () async {
      // RN gates on android/ (returns null); web excludes expo — so neither the
      // mobile nor the web adapter wrongly claims it.
      final dir = await _project(
        deps: {'expo': '51.0.0'},
        scripts: {'start': 'expo start'},
      );
      addTearDown(() => dir.delete(recursive: true));
      expect((await registry.detectFor(dir.path)).id, 'generic');
    });
  });
}
