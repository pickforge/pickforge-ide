@Tags(['emulator'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

void main() {
  test(
    'end-to-end boot, run, hot reload, stop',
    () async {
      const avdId = String.fromEnvironment('PICKFORGE_E2E_AVD');
      if (avdId.isEmpty) {
        markTestSkipped('Set PICKFORGE_E2E_AVD to run emulator E2E.');
        return;
      }

      final runner = RealProcessRunner();
      final discovery = DeviceDiscoveryService(runner);
      final launcher = AvdLauncher(runner);
      final poller = BootReadinessPoller(runner);
      final run = RunSessionController(runner);
      final eventLines = <String>[];

      await launcher.launch(avdId);
      final ready = await poller
          .poll(avdId: avdId, timeout: const Duration(minutes: 2))
          .firstWhere((event) => event is BootReady) as BootReady;
      final snapshot = await discovery.snapshot();
      expect(
        snapshot.running.any((device) => device.serial == ready.serial),
        true,
      );

      final session = await run.start(
        projectRoot: 'fixtures/sample_flutter_app',
        serial: ready.serial,
        extraArgs: const [],
      );
      final eventSub = session.events.listen(
        (event) => eventLines.add('${DateTime.now().toIso8601String()} $event'),
      );
      addTearDown(eventSub.cancel);
      await session.events.firstWhere(
        (event) => event.maybeWhen(
          vmServiceReady: (_) => true,
          orElse: () => false,
        ),
      );
      expect(session.vmServiceUri, isNotNull);
      expect(await session.hotReload(), true);
      await session.stop();
      await _writeArtifact(
        'emulator-e2e.log',
        [
          'avd=$avdId',
          'serial=${ready.serial}',
          'vmServiceUri=${session.vmServiceUri}',
          '',
          ...eventLines,
        ].join('\n'),
      );
    },
    timeout: const Timeout(Duration(minutes: 8)),
  );
}

Future<void> _writeArtifact(String filename, String contents) async {
  const artifactDir = String.fromEnvironment('PICKFORGE_E2E_ARTIFACT_DIR');
  if (artifactDir.isEmpty) return;
  final dir = Directory(artifactDir)..createSync(recursive: true);
  await File(p.join(dir.path, filename)).writeAsString(contents, flush: true);
}
