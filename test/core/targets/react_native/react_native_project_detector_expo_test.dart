import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

Future<Directory> _project({
  bool reactNativeDep = true,
  bool expoDep = false,
  bool expoInDevDeps = false,
  String? configFile,
}) async {
  final dir = await Directory.systemTemp.createTemp('rn_expo');
  final deps = <String, String>{
    if (reactNativeDep) 'react-native': '0.74.0',
    if (expoDep && !expoInDevDeps) 'expo': '51.0.0',
  };
  final devDeps = <String, String>{
    if (expoDep && expoInDevDeps) 'expo': '51.0.0',
  };
  await File(p.join(dir.path, 'package.json')).writeAsString(
    jsonEncode({'dependencies': deps, 'devDependencies': devDeps}),
  );
  if (configFile != null) {
    await File(p.join(dir.path, configFile)).writeAsString('{}\n');
  }
  return dir;
}

void main() {
  const detector = ReactNativeProjectDetector();

  test('detects an Expo project from the expo dependency + app.json', () async {
    final dir = await _project(expoDep: true, configFile: 'app.json');
    addTearDown(() => dir.delete(recursive: true));
    final info = await detector.detect(dir.path);
    expect(info!.isExpo, isTrue);
    expect(info.expo!.configPath, 'app.json');
  });

  test('detects Expo when it is only a devDependency', () async {
    final dir = await _project(expoDep: true, expoInDevDeps: true);
    addTearDown(() => dir.delete(recursive: true));
    final info = await detector.detect(dir.path);
    expect(info!.isExpo, isTrue);
    expect(info.expo!.configPath, isNull); // no config file present
  });

  test('records the Expo config path when present', () async {
    final dir = await _project(expoDep: true, configFile: 'app.config.ts');
    addTearDown(() => dir.delete(recursive: true));
    final info = await detector.detect(dir.path);
    expect(info!.expo!.configPath, 'app.config.ts');
  });

  test('detects via expo even without an explicit react-native dep', () async {
    final dir = await _project(reactNativeDep: false, expoDep: true);
    addTearDown(() => dir.delete(recursive: true));
    expect((await detector.detect(dir.path))!.isExpo, isTrue);
  });

  test('a bare RN project with app.json is NOT Expo', () async {
    // RN CLI templates ship an app.json; the config file alone must not flip a
    // non-Expo project into the Expo launch path.
    final dir = await _project(configFile: 'app.json');
    addTearDown(() => dir.delete(recursive: true));
    final info = await detector.detect(dir.path);
    expect(info, isNotNull);
    expect(info!.isExpo, isFalse);
    expect(info.expo, isNull);
  });

  test('a bare React Native project is not Expo', () async {
    final dir = await _project();
    addTearDown(() => dir.delete(recursive: true));
    expect((await detector.detect(dir.path))!.isExpo, isFalse);
  });

  test('a project with only app.json (no RN/Expo dep) is not detected',
      () async {
    final dir = await _project(reactNativeDep: false, configFile: 'app.json');
    addTearDown(() => dir.delete(recursive: true));
    expect(await detector.detect(dir.path), isNull);
  });
}
