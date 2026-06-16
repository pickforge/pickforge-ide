import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/storage/project_id.dart';

void main() {
  test('deterministic for the same root', () {
    expect(
      ProjectId.forRoot('/home/dev/my-app'),
      ProjectId.forRoot('/home/dev/my-app'),
    );
  });

  test('different roots yield different ids', () {
    expect(
      ProjectId.forRoot('/home/dev/app-one'),
      isNot(ProjectId.forRoot('/home/dev/app-two')),
    );
  });

  test('id contains a slug from the basename', () {
    expect(ProjectId.forRoot('/home/dev/My-App'), startsWith('my-app-'));
  });

  test('same root and same remote is stable', () {
    expect(
      ProjectId.forRoot('/home/dev/app', repoRemoteUrl: 'git@host:o/r.git'),
      ProjectId.forRoot('/home/dev/app', repoRemoteUrl: 'git@host:o/r.git'),
    );
  });

  test('changing remote changes the id', () {
    expect(
      ProjectId.forRoot('/home/dev/app', repoRemoteUrl: 'git@host:o/a.git'),
      isNot(
        ProjectId.forRoot('/home/dev/app', repoRemoteUrl: 'git@host:o/b.git'),
      ),
    );
  });

  test('slug lowercases and dashes non-alphanumerics', () {
    expect(
      ProjectId.forRoot('/home/dev/My Cool_App!!'),
      startsWith('my-cool-app-'),
    );
  });

  test('empty slug yields the bare 16-char hash with no dash', () {
    final id = ProjectId.forRoot('/home/dev/@@@');
    expect(id, '3419e692fe526e4e');
    expect(id, matches(RegExp(r'^[0-9a-f]{16}$')));
  });

  test('empty slug with a high-bit hash stays 16 hex chars and has no dash',
      () {
    final id = ProjectId.forRoot('/home/dev/---');
    expect(id, 'd9532491178e30cf');
    expect(id, matches(RegExp(r'^[0-9a-f]{16}$')));
    expect(id.contains('-'), isFalse);
  });

  test('hash suffix is exactly 16 lowercase hex chars', () {
    final id = ProjectId.forRoot('/fixed/path');
    final suffix = id.split('-').last;
    expect(suffix, matches(RegExp(r'^[0-9a-f]{16}$')));
  });

  test('matches the known FNV-1a 64-bit vector for a fixed path', () {
    expect(ProjectId.forRoot('/fixed/path'), endsWith('11e00e3b173d5eb6'));
  });

  test('matches the known FNV-1a 64-bit vector for a fixed path and remote',
      () {
    expect(
      ProjectId.forRoot('/fixed/path', repoRemoteUrl: 'git@host:o/r.git'),
      endsWith('538f7608cf72e96c'),
    );
  });
}
