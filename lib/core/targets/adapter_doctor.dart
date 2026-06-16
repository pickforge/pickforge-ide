import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/process/binary_detector.dart';

/// The outcome of a tool/runtime availability check.
enum DoctorStatus { ok, missing, unknown }

/// A single environment check (e.g. "ADB", "Xcode", "Node").
class DoctorCheck extends Equatable {
  const DoctorCheck({required this.label, required this.status, this.detail});

  final String label;
  final DoctorStatus status;
  final String? detail;

  @override
  List<Object?> get props => [label, status, detail];
}

/// Runs the toolchain availability checks that gate each target adapter's
/// runtime features, so the workbench doctor panel can explain what's usable.
///
/// Binary-only and side-effect free; macOS-specific checks are reported as
/// `unknown` off macOS rather than run.
class AdapterDoctor {
  AdapterDoctor(this._detector, {bool? isMacOS}) : _isMacOSOverride = isMacOS;

  final BinaryDetector _detector;
  final bool? _isMacOSOverride;

  bool get _isMacOS => _isMacOSOverride ?? Platform.isMacOS;

  Future<List<DoctorCheck>> run() async {
    return [
      await _binary('Flutter SDK', 'flutter'),
      await _binary('ADB (Android)', 'adb'),
      await _binary('Node / npm', 'node'),
      if (_isMacOS)
        await _binary('Xcode (xcrun)', 'xcrun')
      else
        const DoctorCheck(
          label: 'Xcode (xcrun)',
          status: DoctorStatus.unknown,
          detail: 'macOS only',
        ),
      await _browser(),
    ];
  }

  Future<DoctorCheck> _binary(String label, String binary) async {
    final present = await _detector.isBinaryOnPath(binary);
    return DoctorCheck(
      label: label,
      status: present ? DoctorStatus.ok : DoctorStatus.missing,
    );
  }

  Future<DoctorCheck> _browser() async {
    for (final binary in const ['google-chrome', 'chromium', 'chrome']) {
      if (await _detector.isBinaryOnPath(binary)) {
        return const DoctorCheck(
          label: 'Browser (CDP)',
          status: DoctorStatus.ok,
        );
      }
    }
    return const DoctorCheck(
      label: 'Browser (CDP)',
      status: DoctorStatus.missing,
    );
  }
}
