import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/native_ios/ios_project_detector.dart';
import 'package:pickforge/core/targets/native_ios/ios_target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

Future<Directory> _iosProject({
  bool workspace = false,
  bool xcodeproj = true,
  String? packageSwift,
}) async {
  final dir = await Directory.systemTemp.createTemp('ios_project');
  if (workspace) {
    Directory(p.join(dir.path, 'Demo.xcworkspace')).createSync();
  }
  if (xcodeproj) {
    Directory(p.join(dir.path, 'Demo.xcodeproj')).createSync();
  }
  if (packageSwift != null) {
    await File(p.join(dir.path, 'Package.swift')).writeAsString(packageSwift);
  }
  return dir;
}

void main() {
  const adapter = IosTargetAdapter();
  const detector = IosProjectDetector();

  group('IosProjectDetector', () {
    test('detects an .xcodeproj at the root', () async {
      final dir = await _iosProject();
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.xcodeproj, 'Demo.xcodeproj');
      expect(info.isExact, isTrue);
    });

    test('detects both .xcworkspace and .xcodeproj when present', () async {
      final dir = await _iosProject(workspace: true);
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info!.workspace, 'Demo.xcworkspace');
      expect(info.xcodeproj, 'Demo.xcodeproj');
      expect(info.isExact, isTrue);
    });

    test('ignores a plain FILE named like an xcode bundle', () async {
      final dir = await Directory.systemTemp.createTemp('ios_fake');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'Demo.xcodeproj')).writeAsString('not a dir');
      expect(await detector.detect(dir.path), isNull);
    });

    test('ignores an executableTarget inside a comment', () async {
      final dir = await _iosProject(
        xcodeproj: false,
        packageSwift: '// .executableTarget(name: "A")\n'
            'let p = Package(targets: [.target(name: "Lib")])',
      );
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNull);
    });

    test('detects an executable SwiftPM package as a soft signal', () async {
      final dir = await _iosProject(
        xcodeproj: false,
        packageSwift:
            'let p = Package(targets: [.executableTarget(name: "A")])',
      );
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.isExact, isFalse);
      expect(info.hasAppPackage, isTrue);
    });

    test('ignores a library-only SwiftPM package', () async {
      final dir = await _iosProject(
        xcodeproj: false,
        packageSwift: 'let p = Package(targets: [.target(name: "Lib")])',
      );
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNull);
    });

    test('returns null for a non-iOS directory', () async {
      final dir = await Directory.systemTemp.createTemp('not_ios');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'README.md')).writeAsString('hi\n');
      expect(await detector.detect(dir.path), isNull);
    });
  });

  group('IosTargetAdapter', () {
    test('identity and never declares exact source mapping', () {
      expect(adapter.id, 'native_ios');
      expect(adapter.displayName, 'Native iOS');
      expect(adapter.priority, 55);
      expect(adapter.capabilities.has(TargetCapability.detect), isTrue);
      expect(
        adapter.capabilities.has(TargetCapability.mapSelectionToSource),
        isFalse,
      );
    });

    test('runtime capabilities are offered only on macOS', () {
      const onMac = IosTargetAdapter(isMacOS: true);
      bool mac(TargetCapability c) => onMac.capabilities.has(c);
      expect(mac(TargetCapability.detect), isTrue);
      expect(mac(TargetCapability.launch), isTrue);
      expect(mac(TargetCapability.captureScreenshot), isTrue);
      expect(mac(TargetCapability.streamLogs), isTrue);

      const offMac = IosTargetAdapter(isMacOS: false);
      bool other(TargetCapability c) => offMac.capabilities.has(c);
      expect(other(TargetCapability.detect), isTrue);
      expect(other(TargetCapability.launch), isFalse);
      expect(other(TargetCapability.captureScreenshot), isFalse);
      expect(other(TargetCapability.streamLogs), isFalse);
    });

    test('detect surfaces the xcode artifacts in the details', () async {
      final dir = await _iosProject(workspace: true);
      addTearDown(() => dir.delete(recursive: true));
      final detection = await adapter.detect(dir.path);
      expect(detection!.targetId, 'native_ios');
      expect(detection.confidence, DetectionConfidence.exact);
      expect(detection.details?['workspace'], 'Demo.xcworkspace');
    });
  });
}
