import 'package:equatable/equatable.dart';

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

class RunningAndroidDevice extends Equatable {
  const RunningAndroidDevice({
    required this.serial,
    required this.avdName,
    required this.state,
  });

  final String serial;
  final String? avdName;
  final String state;

  @override
  List<Object?> get props => [serial, avdName, state];
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
      if (device.avdName == avd.id || device.avdName == avd.name) {
        return device;
      }
    }
    return null;
  }

  @override
  List<Object?> get props => [avds, running];
}
