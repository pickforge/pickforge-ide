import 'dart:convert';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

@lazySingleton
class DeviceDiscoveryService {
  DeviceDiscoveryService(this._runner);

  final ProcessRunner _runner;

  Future<List<Avd>> listAvds() async {
    try {
      final res = await _runner.run('flutter', ['emulators']);
      if (res.exitCode != 0) return const [];
      return _parseEmulatorsText(res.stdout.toString());
    } on ProcessRunnerException {
      return const [];
    }
  }

  Future<List<RunningAndroidDevice>> listRunningDevices() async {
    try {
      final res = await _runner.run('adb', ['devices', '-l']);
      if (res.exitCode != 0) return const [];
      final devices = _parseAdbDevices(res.stdout.toString());
      final out = <RunningAndroidDevice>[];
      for (final device in devices) {
        if (device.isPhysical) {
          out.add(device);
          continue;
        }
        out.add(
          RunningAndroidDevice(
            serial: device.serial,
            avdName: await _adbAvdName(device.serial),
            state: device.state,
          ),
        );
      }
      return out;
    } on ProcessRunnerException {
      return const [];
    }
  }

  Future<DeviceListSnapshot> snapshot() async {
    final results = await Future.wait([
      listAvds(),
      listRunningDevices(),
      listRunningIosSimulators(),
      listFlutterDeviceTargets(),
    ]);
    return DeviceListSnapshot(
      avds: results[0] as List<Avd>,
      running: [
        ...results[1] as List<RunningAndroidDevice>,
        ...results[2] as List<RunningAndroidDevice>,
        ...results[3] as List<RunningAndroidDevice>,
      ],
    );
  }

  Future<List<RunningAndroidDevice>> listRunningIosSimulators() async {
    try {
      final res = await _runner.run(
        'xcrun',
        ['simctl', 'list', 'devices', 'booted', '--json'],
      );
      if (res.exitCode != 0) return const [];
      return _parseBootedIosSimulators(res.stdout.toString());
    } on ProcessRunnerException {
      return const [];
    }
  }

  Future<List<RunningAndroidDevice>> listWebTargets() async {
    final devices = await listFlutterDeviceTargets();
    return devices.where((device) => device.isWebTarget).toList();
  }

  Future<List<RunningAndroidDevice>> listDesktopTargets() async {
    final devices = await listFlutterDeviceTargets();
    return devices.where((device) => device.isDesktopTarget).toList();
  }

  Future<List<RunningAndroidDevice>> listFlutterDeviceTargets() async {
    try {
      final res = await _runner.run('flutter', ['devices', '--machine']);
      if (res.exitCode != 0) return const [];
      return _parseFlutterDeviceTargets(res.stdout.toString());
    } on ProcessRunnerException {
      return const [];
    }
  }

  Stream<DeviceListSnapshot> watch({
    Duration interval = const Duration(seconds: 4),
  }) async* {
    yield await snapshot();
    while (true) {
      await Future<void>.delayed(interval);
      yield await snapshot();
    }
  }

  Future<String?> _adbAvdName(String serial) async {
    try {
      final res =
          await _runner.run('adb', ['-s', serial, 'emu', 'avd', 'name']);
      if (res.exitCode != 0) return null;
      final lines = res.stdout
          .toString()
          .split('\n')
          .map((line) => line.trim())
          .where((line) => line.isNotEmpty && line != 'OK')
          .toList();
      return lines.isEmpty ? null : lines.first;
    } on ProcessRunnerException {
      return null;
    }
  }

  List<Avd> _parseEmulatorsText(String raw) {
    final separator = RegExp('\\s+${String.fromCharCode(0x2022)}\\s+');
    final out = <Avd>[];
    for (final line in raw.split('\n')) {
      final columns =
          line.trim().split(separator).map((column) => column.trim()).toList();
      if (columns.length < 4 || columns.first == 'Id') continue;
      final id = columns[0];
      if (id.isEmpty) continue;
      final name = columns[1].isEmpty ? id : columns[1];
      out.add(
        Avd(
          id: id,
          name: name,
          platform: columns[3].isEmpty ? androidEmulatorPlatform : columns[3],
        ),
      );
    }
    return out;
  }

  List<RunningAndroidDevice> _parseAdbDevices(String raw) {
    final out = <RunningAndroidDevice>[];
    for (final line in raw.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.isEmpty || trimmed.startsWith('List of devices')) continue;
      final tokens = trimmed.split(RegExp(r'\s+'));
      if (tokens.length < 2) continue;
      final serial = tokens[0];
      final isEmulator = serial.startsWith('emulator-');
      out.add(
        RunningAndroidDevice(
          serial: serial,
          avdName: null,
          state: tokens[1],
          kind: isEmulator
              ? AndroidDeviceKind.emulator
              : AndroidDeviceKind.physical,
          model: _adbDetail(tokens, 'model'),
        ),
      );
    }
    return out;
  }

  String? _adbDetail(List<String> tokens, String key) {
    final prefix = '$key:';
    for (final token in tokens.skip(2)) {
      if (!token.startsWith(prefix)) continue;
      final value = token.substring(prefix.length).replaceAll('_', ' ').trim();
      return value.isEmpty ? null : value;
    }
    return null;
  }

  List<RunningAndroidDevice> _parseBootedIosSimulators(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return const [];
      final devices = decoded['devices'];
      if (devices is! Map<String, dynamic>) return const [];
      final out = <RunningAndroidDevice>[];
      for (final runtimeDevices in devices.values) {
        if (runtimeDevices is! List) continue;
        for (final item in runtimeDevices.whereType<Map<String, dynamic>>()) {
          final udid = item['udid'] as String?;
          final name = item['name'] as String?;
          final state = item['state'] as String?;
          final available = item['isAvailable'] as bool? ?? true;
          if (udid == null || udid.isEmpty || !available) continue;
          if (state != null && state != 'Booted') continue;
          out.add(
            RunningAndroidDevice(
              serial: udid,
              avdName: name,
              state: 'device',
              kind: AndroidDeviceKind.iosSimulator,
              model: name,
            ),
          );
        }
      }
      return out;
    } on FormatException {
      return const [];
    }
  }

  List<RunningAndroidDevice> _parseFlutterDeviceTargets(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      final out = <RunningAndroidDevice>[];
      for (final json in decoded.whereType<Map<String, dynamic>>()) {
        final device = _flutterDeviceTargetFromJson(json);
        if (device != null && device.serial.isNotEmpty) out.add(device);
      }
      return out;
    } on FormatException {
      return const [];
    }
  }

  RunningAndroidDevice? _flutterDeviceTargetFromJson(
    Map<String, dynamic> json,
  ) {
    if (json['isSupported'] == false) return null;
    if (_isWebDevice(json)) {
      return _deviceFromFlutterJson(json, AndroidDeviceKind.web);
    }
    if (_isDesktopDevice(json)) {
      return _deviceFromFlutterJson(json, AndroidDeviceKind.desktop);
    }
    return null;
  }

  RunningAndroidDevice _deviceFromFlutterJson(
    Map<String, dynamic> json,
    AndroidDeviceKind kind,
  ) {
    return RunningAndroidDevice(
      serial: (json['id'] as String? ?? '').trim(),
      avdName: _trimmedString(json['name']),
      state: 'device',
      kind: kind,
      model: _trimmedString(json['targetPlatform']),
    );
  }

  bool _isWebDevice(Map<String, dynamic> json) {
    final id = json['id'] as String?;
    final targetPlatform = json['targetPlatform'] as String?;
    final category = json['category'] as String?;
    return id == flutterWebChromeId ||
        id == flutterWebServerId ||
        id == 'edge' ||
        category == 'web' ||
        targetPlatform?.startsWith('web-') == true;
  }

  bool _isDesktopDevice(Map<String, dynamic> json) {
    final id = json['id'] as String?;
    final targetPlatform = json['targetPlatform'] as String?;
    final category = json['category'] as String?;
    return id == flutterLinuxDeviceId ||
        id == flutterMacosDeviceId ||
        id == flutterWindowsDeviceId ||
        category == 'desktop' ||
        targetPlatform?.startsWith('linux-') == true ||
        targetPlatform?.startsWith('darwin-') == true ||
        targetPlatform?.startsWith('windows-') == true;
  }

  String? _trimmedString(Object? value) {
    if (value is! String) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
