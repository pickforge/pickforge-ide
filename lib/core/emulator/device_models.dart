import 'package:equatable/equatable.dart';

const androidEmulatorPlatform = 'android';
const androidPhysicalPlatform = 'android-physical';
const iosSimulatorPlatform = 'ios';
const iosFlutterSimulatorId = 'apple_ios_simulator';
const flutterWebPlatform = 'web';
const flutterWebChromeId = 'chrome';
const flutterWebServerId = 'web-server';

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

enum AndroidDeviceKind { emulator, physical, iosSimulator, web }

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
  bool get isIosSimulator => kind == AndroidDeviceKind.iosSimulator;
  bool get isWebTarget => kind == AndroidDeviceKind.web;
  bool get isConnectedDevice => isPhysical || isIosSimulator || isWebTarget;
  String get displayName => avdName ?? model ?? serial;

  Avd get asDeviceAvd => Avd(
        id: serial,
        name: displayName,
        platform: switch (kind) {
          AndroidDeviceKind.physical => androidPhysicalPlatform,
          AndroidDeviceKind.iosSimulator => iosSimulatorPlatform,
          AndroidDeviceKind.web => flutterWebPlatform,
          AndroidDeviceKind.emulator => androidEmulatorPlatform,
        },
      );

  bool matchesAvd(Avd avd) {
    if (avd.platform == androidPhysicalPlatform) {
      return isPhysical && serial == avd.id;
    }
    if (avd.platform == iosSimulatorPlatform) {
      return isIosSimulator &&
          (serial == avd.id ||
              avdName == avd.id ||
              displayName == avd.name ||
              avd.id == iosFlutterSimulatorId);
    }
    if (avd.platform == flutterWebPlatform) {
      return isWebTarget &&
          (serial == avd.id || avdName == avd.id || displayName == avd.name);
    }
    return isEmulator && (avdName == avd.id || avdName == avd.name);
  }

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
      if (device.matchesAvd(avd)) {
        return device;
      }
    }
    return null;
  }

  List<RunningAndroidDevice> get physicalDevices =>
      running.where((device) => device.isPhysical).toList();
  List<RunningAndroidDevice> get iosSimulators =>
      running.where((device) => device.isIosSimulator).toList();
  List<RunningAndroidDevice> get webTargets =>
      running.where((device) => device.isWebTarget).toList();
  List<RunningAndroidDevice> get connectedDevices =>
      running.where((device) => device.isConnectedDevice).toList();

  @override
  List<Object?> get props => [avds, running];
}
