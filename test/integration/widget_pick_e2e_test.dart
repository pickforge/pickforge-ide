@Tags(['emulator'])
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';
import 'package:vm_service/vm_service_io.dart';

void main() {
  test(
    'widget pick captures user-code selection and inspector screenshot',
    () async {
      const avdId = String.fromEnvironment('PICKFORGE_E2E_AVD');
      if (avdId.isEmpty) {
        markTestSkipped('Set PICKFORGE_E2E_AVD to run emulator E2E.');
        return;
      }

      final runner = RealProcessRunner();
      final launcher = AvdLauncher(runner);
      final poller = BootReadinessPoller(runner);
      final run = RunSessionController(runner);
      final projectRoot = await _copyFixtureProject();
      RunSession? session;

      try {
        await launcher.launch(avdId);
        final ready = await poller
            .poll(avdId: avdId, timeout: const Duration(minutes: 2))
            .firstWhere((event) => event is BootReady) as BootReady;

        session = await run.start(
          projectRoot: projectRoot.path,
          serial: ready.serial,
          extraArgs: const [],
        );
        await session.events.firstWhere(
          (event) => event.maybeWhen(
            vmServiceReady: (_) => true,
            orElse: () => false,
          ),
        );

        final service = await vmServiceConnectUri(session.vmServiceUri!);
        addTearDown(service.dispose);
        final vm = await service.getVM();
        final isolateId = (vm.isolates == null || vm.isolates!.isEmpty)
            ? null
            : vm.isolates!.first.id;
        expect(isolateId, isNotNull);
        final ext = InspectorExtensions(service, isolateId: isolateId!);
        await _waitForInspector(ext);
        final repo = InspectorRepository(
          ext,
          const SourceSnippetExtractor(),
          projectRoot: projectRoot.path,
        );
        final selected = await _tapUntilUserSelection(
          runner: runner,
          serial: ready.serial,
          ext: ext,
          repo: repo,
          projectRoot: projectRoot.path,
        );

        expect(selected, isNotNull);
        expect(selected!.node.creationLocation, isNotNull);
        expect(
          const ForgeEligibilityPolicy().canForge(selected, projectRoot.path),
          isTrue,
        );
        expect(selected.screenshotPath, isNotNull);
        expect(File(selected.screenshotPath!).existsSync(), isTrue);
        expect(File(selected.screenshotPath!).lengthSync(), greaterThan(0));
        final rootTree = await ext.getRootWidgetSummaryTree();
        await _writeWidgetPickArtifacts(
          selected: selected,
          rootTree: rootTree,
          projectRoot: projectRoot.path,
          serial: ready.serial,
        );
      } finally {
        await session?.stop();
        await projectRoot.delete(recursive: true);
      }
    },
    timeout: const Timeout(Duration(minutes: 8)),
  );
}

Future<Directory> _copyFixtureProject() async {
  final source = Directory(
    p.join(Directory.current.path, 'fixtures', 'sample_flutter_app'),
  );
  final target = await Directory.systemTemp.createTemp('pickforge_sample_');
  await _copyDirectory(source, target);
  return target;
}

Future<void> _copyDirectory(Directory source, Directory target) async {
  await for (final entity in source.list()) {
    final name = p.basename(entity.path);
    if (name == 'build' || name == '.dart_tool') continue;
    final targetPath = p.join(target.path, name);
    if (entity is Directory) {
      await _copyDirectory(entity, await Directory(targetPath).create());
    } else if (entity is File) {
      await entity.copy(targetPath);
    }
  }
}

Future<void> _waitForInspector(InspectorExtensions ext) async {
  final deadline = DateTime.now().add(const Duration(seconds: 15));
  Object? lastError;
  while (DateTime.now().isBefore(deadline)) {
    try {
      final root = await ext.getRootWidgetSummaryTree();
      if (root != null) return;
    } on Object catch (error) {
      lastError = error;
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }
  fail('Inspector extensions did not become ready: $lastError');
}

Future<SelectedWidget?> _tapUntilUserSelection({
  required RealProcessRunner runner,
  required String serial,
  required InspectorExtensions ext,
  required InspectorRepository repo,
  required String projectRoot,
}) async {
  const taps = [
    ('540', '1200'),
    ('540', '1100'),
    ('540', '1300'),
    ('900', '2100'),
  ];
  SelectedWidget? latest;
  for (final tap in taps) {
    await ext.setSelectMode(enabled: true);
    await Future<void>.delayed(const Duration(milliseconds: 500));
    await runner.run(
      'adb',
      ['-s', serial, 'shell', 'input', 'tap', tap.$1, tap.$2],
    );
    latest = await _waitForUserSelection(
      repo,
      projectRoot,
      timeout: const Duration(seconds: 3),
    );
    if (latest != null &&
        const ForgeEligibilityPolicy().canForge(latest, projectRoot)) {
      return latest;
    }
  }
  return latest;
}

Future<void> _writeWidgetPickArtifacts({
  required SelectedWidget selected,
  required Map<String, dynamic>? rootTree,
  required String projectRoot,
  required String serial,
}) async {
  const artifactDir = String.fromEnvironment('PICKFORGE_E2E_ARTIFACT_DIR');
  if (artifactDir.isEmpty) return;

  final dir = Directory(artifactDir)..createSync(recursive: true);
  final screenshot = selected.screenshotPath;
  if (screenshot != null && File(screenshot).existsSync()) {
    await File(screenshot).copy(p.join(dir.path, 'inspector-screenshot.png'));
  }
  await File(p.join(dir.path, 'widget-pick.txt')).writeAsString(
    [
      'serial=$serial',
      'projectRoot=$projectRoot',
      'className=${selected.node.className}',
      'location=${selected.node.creationLocation}',
      'screenshotPath=${selected.screenshotPath}',
    ].join('\n'),
    flush: true,
  );
  const encoder = JsonEncoder.withIndent('  ');
  await File(p.join(dir.path, 'selected-widget.json')).writeAsString(
    encoder.convert(selected.propertiesJson),
    flush: true,
  );
  if (rootTree != null) {
    await File(p.join(dir.path, 'inspector-root.json')).writeAsString(
      encoder.convert(rootTree),
      flush: true,
    );
  }
}

Future<SelectedWidget?> _waitForUserSelection(
  InspectorRepository repo,
  String projectRoot, {
  Duration timeout = const Duration(seconds: 8),
}) async {
  final deadline = DateTime.now().add(timeout);
  SelectedWidget? latest;
  while (DateTime.now().isBefore(deadline)) {
    latest = await repo.fetchSelection();
    if (latest != null &&
        const ForgeEligibilityPolicy().canForge(latest, projectRoot)) {
      return latest;
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }
  return latest;
}
