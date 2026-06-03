import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';

void main() {
  test('toEmulatorArgs emits supported startup flags', () {
    const options = EmulatorLaunchOptions(
      noAudio: true,
      gpuMode: EmulatorGpuMode.host,
      noSnapshotLoad: true,
      port: 5556,
      cores: 4,
    );

    expect(options.toEmulatorArgs(), [
      '-no-audio',
      '-gpu',
      'host',
      '-no-snapshot-load',
      '-port',
      '5556',
      '-cores',
      '4',
    ]);
  });

  test('validates documented port shape', () {
    expect(
      const EmulatorLaunchOptions(port: 5555).validationErrors,
      contains('Port must be an even integer from 5554 to 5682.'),
    );
    expect(
      const EmulatorLaunchOptions(port: 5684).validationErrors,
      contains('Port must be an even integer from 5554 to 5682.'),
    );
  });

  test('validates positive CPU cores', () {
    expect(
      const EmulatorLaunchOptions(cores: 0).validationErrors,
      contains('CPU cores must be greater than zero.'),
    );
  });

  test('round-trips JSON', () {
    const options = EmulatorLaunchOptions(
      noAudio: true,
      gpuMode: EmulatorGpuMode.swiftshader,
      noSnapshotLoad: true,
      port: 5560,
      cores: 2,
    );

    expect(EmulatorLaunchOptions.fromJson(options.toJson()), options);
  });

  test('rejects unknown GPU modes from JSON', () {
    expect(
      () => EmulatorLaunchOptions.fromJson(const {'gpuMode': 'unknown'}),
      throwsFormatException,
    );
  });
}
