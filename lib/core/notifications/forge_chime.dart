import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';

/// The brand sound cue — a short rising "forge bell" (A4 → E5 → A5 arpeggio
/// with a bright tail) synthesized on first use and cached as a WAV.
///
/// Playback shells out to whichever system player exists (PipeWire/Pulse/ALSA
/// on Linux, afplay on macOS, PowerShell's SoundPlayer on Windows). Sound is
/// feedback, never a dependency: every failure is silent.
class ForgeChime {
  ForgeChime({
    required ProcessRunner runner,
    Directory? cacheDirectory,
    String? operatingSystem,
  })  : _runner = runner,
        _cacheDirectory = cacheDirectory,
        _operatingSystem = operatingSystem ?? Platform.operatingSystem;

  final ProcessRunner _runner;
  final Directory? _cacheDirectory;
  final String _operatingSystem;

  static const _sampleRate = 48000;
  static const _volume = 0.32;

  /// (startHz, endHz, seconds) segments played back to back — the chat-ready
  /// arpeggio. Distinct from PickScribe's C-major cues: PickForge rings in A.
  static const _readySegments = <(double, double, double)>[
    (440.0, 440.0, 0.055), // A4 — the strike
    (659.25, 659.25, 0.075), // E5
    (880.0, 1108.73, 0.12), // A5 with a bright lift to C#6 — the ring
  ];

  String? _resolvedPlayer;
  Future<void> _playing = Future.value();

  /// Plays the chat-ready cue. Never throws; never blocks the caller beyond
  /// scheduling. Concurrent calls coalesce behind one playback chain.
  Future<void> playChatReady() {
    return _playing = _playing.then((_) async {
      try {
        final path = await _cuePath();
        await _play(path);
      } on Object {
        // Silent: a missing player or unwritable cache must never surface.
      }
    });
  }

  Future<String> _cuePath() async {
    final dir = _cacheDirectory ??
        Directory(p.join(Directory.systemTemp.path, 'pickforge', 'sounds'));
    await dir.create(recursive: true);
    final file = File(p.join(dir.path, 'chat-ready.wav'));
    if (!file.existsSync()) {
      await file.writeAsBytes(synthesizeWav(_readySegments));
    }
    return file.path;
  }

  Future<void> _play(String path) async {
    for (final command in _playerCommands(path)) {
      if (_resolvedPlayer != null && command.executable != _resolvedPlayer) {
        continue;
      }
      try {
        final result = await _runner.run(command.executable, command.arguments);
        if (result.exitCode == 0) {
          _resolvedPlayer = command.executable;
          return;
        }
      } on Object {
        // Try the next player.
      }
    }
  }

  List<({String executable, List<String> arguments})> _playerCommands(
    String path,
  ) {
    return switch (_operatingSystem) {
      'macos' => [
          (executable: 'afplay', arguments: [path]),
        ],
      'windows' => [
          (
            executable: 'powershell',
            arguments: [
              '-NoProfile',
              '-Command',
              '(New-Object Media.SoundPlayer "$path").PlaySync()',
            ],
          ),
        ],
      _ => [
          (executable: 'pw-play', arguments: [path]),
          (executable: 'paplay', arguments: [path]),
          (executable: 'aplay', arguments: ['-q', path]),
        ],
    };
  }

  /// Renders 16-bit mono PCM WAV bytes for the given sweep segments with a
  /// short attack/release envelope (no clicks).
  static Uint8List synthesizeWav(List<(double, double, double)> segments) {
    final samples = <int>[];
    for (final (fromHz, toHz, seconds) in segments) {
      final count = (_sampleRate * seconds).round();
      var phase = 0.0;
      for (var i = 0; i < count; i++) {
        final t = i / count;
        final hz = fromHz + (toHz - fromHz) * t;
        phase += 2 * math.pi * hz / _sampleRate;
        final envelope = _unitCap(t * 24) * _unitCap((1 - t) * 6);
        final value = math.sin(phase) * envelope * _volume;
        samples.add((value * 32767).round());
      }
    }

    final dataLength = samples.length * 2;
    final bytes = BytesBuilder()
      ..add('RIFF'.codeUnits)
      ..add(_uint32(36 + dataLength))
      ..add('WAVEfmt '.codeUnits)
      ..add(_uint32(16))
      ..add(_uint16(1)) // PCM
      ..add(_uint16(1)) // mono
      ..add(_uint32(_sampleRate))
      ..add(_uint32(_sampleRate * 2))
      ..add(_uint16(2))
      ..add(_uint16(16))
      ..add('data'.codeUnits)
      ..add(_uint32(dataLength));
    for (final sample in samples) {
      bytes.add(_uint16(sample & 0xFFFF));
    }
    return bytes.toBytes();
  }

  static double _unitCap(double value) => value > 1 ? 1 : value;

  static List<int> _uint32(int value) => [
        value & 0xFF,
        (value >> 8) & 0xFF,
        (value >> 16) & 0xFF,
        (value >> 24) & 0xFF,
      ];

  static List<int> _uint16(int value) => [value & 0xFF, (value >> 8) & 0xFF];
}
