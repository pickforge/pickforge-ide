import 'package:equatable/equatable.dart';

const androidEmulatorPlatform = 'android';
const androidPhysicalPlatform = 'android-physical';

class Avd extends Equatable {
  const Avd({
    required this.id,
    required this.name,
    required this.platform,
  });

  final String id;
  final String name;
  final String platform;

  @override
  List<Object?> get props => [id, name, platform];
}

enum AndroidDeviceKind { emulator, physical }

class RunningAndroidDevice extends Equatable {
  const RunningAndroidDevice({
    required this.serial,
    required this.avdName,
    required this.state,
    this.kind = AndroidDeviceKind.emulator,
    this.model,
  });

  final String serial;
  final String? avdName;
  final String state;
  final AndroidDeviceKind kind;
  final String? model;

  bool get isEmulator => kind == AndroidDeviceKind.emulator;
  bool get isPhysical => kind == AndroidDeviceKind.physical;
  String get displayName => avdName ?? model ?? serial;

  Avd get asDeviceAvd => Avd(
        id: serial,
        name: displayName,
        platform:
            isPhysical ? androidPhysicalPlatform : androidEmulatorPlatform,
      );

  @override
  List<Object?> get props => [serial, avdName, state, kind, model];
}

class DeviceListSnapshot extends Equatable {
  const DeviceListSnapshot({
    required this.avds,
    required this.running,
  });

  final List<Avd> avds;
  final List<RunningAndroidDevice> running;

  RunningAndroidDevice? runningFor(Avd avd) {
    for (final device in running) {
      if (avd.platform == androidPhysicalPlatform &&
          device.isPhysical &&
          device.serial == avd.id) {
        return device;
      }
      if (device.isEmulator &&
          (device.avdName == avd.id || device.avdName == avd.name)) {
        return device;
      }
    }
    return null;
  }

  List<RunningAndroidDevice> get physicalDevices =>
      running.where((device) => device.isPhysical).toList();

  @override
  List<Object?> get props => [avds, running];
}
