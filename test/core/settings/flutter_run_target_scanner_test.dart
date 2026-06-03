import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/settings/flutter_run_target_scanner.dart';

void main() {
  late Directory tmp;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('pickforge-targets-');
  });

  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('scans lib/main*.dart targets and derives flavors', () async {
    Directory(p.join(tmp.path, 'lib')).createSync(recursive: true);
    File(p.join(tmp.path, 'lib', 'main.dart'))
        .writeAsStringSync('void main() {}');
    File(p.join(tmp.path, 'lib', 'main_dev.dart')).writeAsStringSync('');
    File(p.join(tmp.path, 'lib', 'main_staging.dart')).writeAsStringSync('');
    File(p.join(tmp.path, 'lib', 'not_main.dart')).writeAsStringSync('');

    final metadata = await const FlutterRunTargetScanner().scan(tmp.path);

    expect(
      metadata.targetFiles,
      ['lib/main.dart', 'lib/main_dev.dart', 'lib/main_staging.dart'],
    );
    expect(metadata.flavors, ['dev', 'staging']);
  });

  test('parses Gradle product flavors', () async {
    File(p.join(tmp.path, 'android', 'app', 'build.gradle'))
      ..createSync(recursive: true)
      ..writeAsStringSync('''
android {
  flavorDimensions "env"
  productFlavors {
    dev { dimension "env" }
    prod { dimension "env" }
  }
}
''');

    final metadata = await const FlutterRunTargetScanner().scan(tmp.path);

    expect(metadata.flavors, ['dev', 'prod']);
  });

  test('parses Kotlin DSL product flavors', () async {
    File(p.join(tmp.path, 'android', 'app', 'build.gradle.kts'))
      ..createSync(recursive: true)
      ..writeAsStringSync('''
android {
  productFlavors {
    create("qa") {
      dimension = "env"
    }
  }
}
''');

    final metadata = await const FlutterRunTargetScanner().scan(tmp.path);

    expect(metadata.flavors, ['qa']);
  });
}
