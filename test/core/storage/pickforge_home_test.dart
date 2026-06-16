import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/pickforge_home.dart';

void main() {
  test('PICKFORGE_HOME override wins', () {
    final resolved = PickforgeHome.resolve(
      environment: {
        'PICKFORGE_HOME': '/custom/pf',
        'HOME': '/home/user',
      },
      isWindows: false,
    );
    expect(resolved, '/custom/pf');
  });

  test('POSIX HOME resolves to <home>/.pickforge', () {
    final resolved = PickforgeHome.resolve(
      environment: {'HOME': '/home/user'},
      isWindows: false,
    );
    expect(resolved, p.join('/home/user', '.pickforge'));
  });

  test('Windows USERPROFILE resolves to <userprofile>/.pickforge', () {
    final resolved = PickforgeHome.resolve(
      environment: {'USERPROFILE': r'C:\Users\dev'},
      isWindows: true,
    );
    expect(resolved, p.join(r'C:\Users\dev', '.pickforge'));
  });

  test('Windows HOMEDRIVE/HOMEPATH fallback when USERPROFILE is unset', () {
    final resolved = PickforgeHome.resolve(
      environment: {
        'HOMEDRIVE': 'C:',
        'HOMEPATH': r'\Users\dev',
      },
      isWindows: true,
    );
    expect(resolved, p.join(p.join('C:', r'\Users\dev'), '.pickforge'));
  });

  test('missing HOME on POSIX throws PickforgeHomeUnavailableException', () {
    expect(
      () => PickforgeHome.resolve(environment: {}, isWindows: false),
      throwsA(isA<PickforgeHomeUnavailableException>()),
    );
  });
}
