import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/settings/run_args.dart';

void main() {
  test('parses structured build mode, flavor, and manual args', () {
    const args = RunArgs(
      extraArgs: [
        '--release',
        '--flavor',
        'dev',
        '--dart-define=FOO=bar',
      ],
    );

    final parsed = args.parsed;

    expect(parsed.buildMode, FlutterBuildMode.release);
    expect(parsed.flavor, 'dev');
    expect(parsed.manualExtraArgs, ['--dart-define=FOO=bar']);
  });

  test('updates build mode and preserves flavor plus manual args', () {
    const args = RunArgs(
      extraArgs: ['--flavor=dev', '--dart-define=FOO=bar'],
    );

    final updated = args.withBuildMode(FlutterBuildMode.profile);

    expect(
      updated.extraArgs,
      ['--profile', '--flavor', 'dev', '--dart-define=FOO=bar'],
    );
  });

  test('debug build mode removes explicit mode flags', () {
    const args = RunArgs(extraArgs: ['--release', '--flavor', 'prod']);

    final updated = args.withBuildMode(FlutterBuildMode.debug);

    expect(updated.extraArgs, ['--flavor', 'prod']);
  });

  test('parses and formats manual extra args text', () {
    final args = parseExtraArgsText(
      '--dart-define=NAME="Pick Forge" "--trace-startup"',
    );

    expect(args, ['--dart-define=NAME=Pick Forge', '--trace-startup']);
    expect(
      formatExtraArgsText(args),
      '"--dart-define=NAME=Pick Forge" --trace-startup',
    );
  });
}
