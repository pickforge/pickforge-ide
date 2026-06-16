import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

import 'package:pickforge/core/storage/context_storage_location.dart';

class ResolvedContextDirectory extends Equatable {
  const ResolvedContextDirectory({
    required this.projectRoot,
    required this.projectId,
    required this.storageLocation,
    required this.contextDir,
    required this.runsDir,
    required this.chatsDir,
    required this.isProjectLocal,
  });

  final String projectRoot;
  final String projectId;
  final ContextStorageLocation storageLocation;
  final String contextDir;
  final String runsDir;
  final String chatsDir;
  final bool isProjectLocal;

  String get ipcSockPath => p.join(contextDir, 'ipc.sock-path');

  /// Clipboard pastes live next to runs/chats. Project-local keeps the legacy
  /// `<root>/.pickforge/pastes`; home/custom uses `<base>/pastes` (a sibling of
  /// the context dir rather than nesting under it).
  String get pastesDir => isProjectLocal
      ? p.join(contextDir, 'pastes')
      : p.join(p.dirname(runsDir), 'pastes');

  /// Project-local skill overrides keep the legacy `<root>/.pickforge/skills`;
  /// home/custom uses `<base>/skills` (a sibling of runs/chats).
  String get skillsDir => isProjectLocal
      ? p.join(contextDir, 'skills')
      : p.join(p.dirname(runsDir), 'skills');

  /// Project-local prompt-template overrides keep the legacy
  /// `<root>/.pickforge/prompt-templates`; home/custom uses
  /// `<base>/prompt-templates` (a sibling of runs/chats).
  String get promptTemplatesDir => isProjectLocal
      ? p.join(contextDir, 'prompt-templates')
      : p.join(p.dirname(runsDir), 'prompt-templates');

  @override
  List<Object?> get props => [
        projectRoot,
        projectId,
        storageLocation,
        contextDir,
        runsDir,
        chatsDir,
        isProjectLocal,
      ];
}
