import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';

void main() {
  test('TerminalLaunchSpec round-trips through JSON', () {
    const spec = TerminalLaunchSpec(
      id: TerminalProfileId.ghostty,
      scriptPath: '/tmp/wrapper.sh',
      workingDir: '/home/me/app',
      env: <String, String>{'PICKFORGE_SESSION': '/tmp/ses'},
    );
    expect(TerminalLaunchSpec.fromJson(spec.toJson()), spec);
  });
}
