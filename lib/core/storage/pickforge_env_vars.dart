import 'package:pickforge/core/storage/pickforge_home.dart';
import 'package:pickforge/core/storage/resolved_context_directory.dart';

/// Builds the `PICKFORGE_*` environment variables injected into every embedded
/// PTY so shells and the agents they spawn can discover the active project's
/// storage layout and IPC endpoint.
///
/// [activeIpcEndpoint] is the live socket path read from the resolved
/// `ipc.sock-path` file; when null (no run session active) the
/// `PICKFORGE_IPC_ENDPOINT` key is omitted entirely.
Map<String, String> pickforgeEnvVars(
  ResolvedContextDirectory resolved, {
  String? activeIpcEndpoint,
  Map<String, String>? environment,
  bool? isWindows,
}) {
  final endpoint = activeIpcEndpoint?.trim();
  return {
    'PICKFORGE_HOME': PickforgeHome.resolve(
      environment: environment,
      isWindows: isWindows,
    ),
    'PICKFORGE_PROJECT_ROOT': resolved.projectRoot,
    'PICKFORGE_CONTEXT_DIR': resolved.contextDir,
    'PICKFORGE_STORAGE_MODE': resolved.storageLocation.wireName,
    if (endpoint != null && endpoint.isNotEmpty)
      'PICKFORGE_IPC_ENDPOINT': endpoint,
  };
}
