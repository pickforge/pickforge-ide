import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/notifications/forge_chime.dart';

class _RecordingRunner implements ProcessRunner {
  _RecordingRunner({this.failing = const {}});

  final Set<String> failing;
  final commands = <String>[];

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    commands.add(executable);
    if (failing.contains(executable)) {
      throw ProcessRunnerException(executable, 'not found');
    }
    return ProcessResult(1, 0, '', '');
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}

void main() {
  late Directory cache;

  setUp(() async {
    cache = await Directory.systemTemp.createTemp('forge-chime-');
  });

  tearDown(() async {
    try {
      await cache.delete(recursive: true);
    } on FileSystemException {
      // Best-effort cleanup.
    }
  });

  test('synthesizeWav renders a valid 16-bit mono PCM file', () {
    final bytes = ForgeChime.synthesizeWav(const [(440.0, 880.0, 0.05)]);

    expect(String.fromCharCodes(bytes.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(bytes.sublist(8, 16)), 'WAVEfmt ');
    expect(String.fromCharCodes(bytes.sublist(36, 40)), 'data');
    // 48kHz * 0.05s * 2 bytes + 44-byte header.
    expect(bytes.length, 44 + 2400 * 2);
    // The tone is not silence.
    expect(bytes.skip(44).any((b) => b != 0), isTrue);
  });

  test('playChatReady writes the cached cue and invokes the player', () async {
    final runner = _RecordingRunner();
    final chime = ForgeChime(
      runner: runner,
      cacheDirectory: cache,
      operatingSystem: 'linux',
    );

    await chime.playChatReady();

    expect(File('${cache.path}/chat-ready.wav').existsSync(), isTrue);
    expect(runner.commands, ['pw-play']);
  });

  test('falls through to the next player and then sticks with it', () async {
    final runner = _RecordingRunner(failing: {'pw-play'});
    final chime = ForgeChime(
      runner: runner,
      cacheDirectory: cache,
      operatingSystem: 'linux',
    );

    await chime.playChatReady();
    await chime.playChatReady();

    expect(runner.commands, ['pw-play', 'paplay', 'paplay']);
  });

  test('is silent when no player exists', () async {
    final runner = _RecordingRunner(failing: {'pw-play', 'paplay', 'aplay'});
    final chime = ForgeChime(
      runner: runner,
      cacheDirectory: cache,
      operatingSystem: 'linux',
    );

    await expectLater(chime.playChatReady(), completes);
  });

  test('uses afplay on macOS', () async {
    final runner = _RecordingRunner();
    final chime = ForgeChime(
      runner: runner,
      cacheDirectory: cache,
      operatingSystem: 'macos',
    );

    await chime.playChatReady();

    expect(runner.commands, ['afplay']);
  });
}
