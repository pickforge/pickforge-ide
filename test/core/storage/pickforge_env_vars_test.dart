import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/pickforge_env_vars.dart';
import 'package:pickforge/core/storage/resolved_context_directory.dart';

void main() {
  ResolvedContextDirectory build({
    ContextStorageLocation? storageLocation,
    String projectRoot = '/home/dev/app',
    String contextDir = '/home/.pickforge/projects/app-x/context',
    bool isProjectLocal = false,
  }) {
    return ResolvedContextDirectory(
      projectRoot: projectRoot,
      projectId: 'app-x',
      storageLocation:
          storageLocation ?? const ContextStorageLocation.pickforgeHome(),
      contextDir: contextDir,
      runsDir: '/home/.pickforge/projects/app-x/runs',
      chatsDir: '/home/.pickforge/projects/app-x/chats',
      isProjectLocal: isProjectLocal,
    );
  }

  const env = {'PICKFORGE_HOME': '/home/.pickforge'};

  test('emits all five vars when an active IPC endpoint is provided', () {
    final vars = pickforgeEnvVars(
      build(),
      activeIpcEndpoint: '/run/pickforge.sock',
      environment: env,
      isWindows: false,
    );

    expect(vars, {
      'PICKFORGE_HOME': '/home/.pickforge',
      'PICKFORGE_PROJECT_ROOT': '/home/dev/app',
      'PICKFORGE_CONTEXT_DIR': '/home/.pickforge/projects/app-x/context',
      'PICKFORGE_STORAGE_MODE': 'home',
      'PICKFORGE_IPC_ENDPOINT': '/run/pickforge.sock',
    });
  });

  test('omits PICKFORGE_IPC_ENDPOINT when no socket is active', () {
    final vars = pickforgeEnvVars(
      build(),
      environment: env,
      isWindows: false,
    );

    expect(vars.containsKey('PICKFORGE_IPC_ENDPOINT'), isFalse);
    expect(vars.keys, hasLength(4));
  });

  test('omits PICKFORGE_IPC_ENDPOINT when the endpoint is blank', () {
    final vars = pickforgeEnvVars(
      build(),
      activeIpcEndpoint: '   ',
      environment: env,
      isWindows: false,
    );

    expect(vars.containsKey('PICKFORGE_IPC_ENDPOINT'), isFalse);
  });

  test('trims the active IPC endpoint', () {
    final vars = pickforgeEnvVars(
      build(),
      activeIpcEndpoint: ' /run/pickforge.sock\n',
      environment: env,
      isWindows: false,
    );

    expect(vars['PICKFORGE_IPC_ENDPOINT'], '/run/pickforge.sock');
  });

  test('STORAGE_MODE follows the resolved storage location wire name', () {
    final local = pickforgeEnvVars(
      build(
        storageLocation: const ContextStorageLocation.projectLocal(),
        contextDir: '/home/dev/app/.pickforge',
        isProjectLocal: true,
      ),
      environment: env,
      isWindows: false,
    );
    expect(local['PICKFORGE_STORAGE_MODE'], 'project-local');

    final custom = pickforgeEnvVars(
      build(storageLocation: const ContextStorageLocation.custom('/cust')),
      environment: env,
      isWindows: false,
    );
    expect(custom['PICKFORGE_STORAGE_MODE'], 'custom');

    final homeMode = pickforgeEnvVars(
      build(),
      environment: env,
      isWindows: false,
    );
    expect(homeMode['PICKFORGE_STORAGE_MODE'], 'home');
  });
}
