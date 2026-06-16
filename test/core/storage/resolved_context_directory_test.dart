import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/resolved_context_directory.dart';

void main() {
  ResolvedContextDirectory build({
    String projectRoot = '/home/dev/app',
    String projectId = 'app-0000000000000000',
    ContextStorageLocation? storageLocation,
    String contextDir = '/base/context',
    String runsDir = '/base/runs',
    String chatsDir = '/base/chats',
    bool isProjectLocal = true,
  }) {
    return ResolvedContextDirectory(
      projectRoot: projectRoot,
      projectId: projectId,
      storageLocation:
          storageLocation ?? const ContextStorageLocation.projectLocal(),
      contextDir: contextDir,
      runsDir: runsDir,
      chatsDir: chatsDir,
      isProjectLocal: isProjectLocal,
    );
  }

  test('value equality holds for identical fields', () {
    expect(build(), build());
  });

  test('differs when any field differs', () {
    expect(build(), isNot(build(contextDir: '/other/context')));
    expect(build(), isNot(build(runsDir: '/other/runs')));
    expect(build(), isNot(build(chatsDir: '/other/chats')));
    expect(build(), isNot(build(projectRoot: '/other/root')));
    expect(build(), isNot(build(projectId: 'other-id')));
    expect(build(), isNot(build(isProjectLocal: false)));
    expect(
      build(),
      isNot(
        build(storageLocation: const ContextStorageLocation.pickforgeHome()),
      ),
    );
  });

  test('exposes all three directory fields', () {
    final resolved = build(
      contextDir: '/home/dev/app/.pickforge',
      runsDir: '/home/dev/app/.pickforge/runs',
      chatsDir: '/home/dev/app/.pickforge/chats',
    );

    expect(resolved.contextDir, '/home/dev/app/.pickforge');
    expect(resolved.runsDir, '/home/dev/app/.pickforge/runs');
    expect(resolved.chatsDir, '/home/dev/app/.pickforge/chats');
  });

  test('ipcSockPath joins contextDir with the socket file name', () {
    final resolved = build(contextDir: '/home/dev/app/.pickforge');

    expect(
      resolved.ipcSockPath,
      p.join('/home/dev/app/.pickforge', 'ipc.sock-path'),
    );
  });

  test('project-local skillsDir/promptTemplatesDir nest under contextDir', () {
    final resolved = build(
      contextDir: '/home/dev/app/.pickforge',
      runsDir: '/home/dev/app/.pickforge/runs',
    );

    expect(resolved.skillsDir, p.join('/home/dev/app/.pickforge', 'skills'));
    expect(
      resolved.promptTemplatesDir,
      p.join('/home/dev/app/.pickforge', 'prompt-templates'),
    );
  });

  test('home-mode skillsDir/promptTemplatesDir sit beside runs/chats', () {
    final resolved = build(
      storageLocation: const ContextStorageLocation.pickforgeHome(),
      contextDir: '/home/.pickforge/projects/app-x/context',
      runsDir: '/home/.pickforge/projects/app-x/runs',
      chatsDir: '/home/.pickforge/projects/app-x/chats',
      isProjectLocal: false,
    );

    expect(
      resolved.skillsDir,
      p.join('/home/.pickforge/projects/app-x', 'skills'),
    );
    expect(
      resolved.promptTemplatesDir,
      p.join('/home/.pickforge/projects/app-x', 'prompt-templates'),
    );
  });
}
