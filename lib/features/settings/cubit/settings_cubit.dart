import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_migrator.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/storage/resolved_context_directory.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';

/// A pending copy-on-switch offer: the new location is already persisted, but
/// the old location still holds data the user may want to bring along.
class ContextStorageCopyOffer extends Equatable {
  const ContextStorageCopyOffer({
    required this.from,
    required this.to,
    required this.plan,
  });

  final ResolvedContextDirectory from;
  final ResolvedContextDirectory to;
  final StorageCopyPlan plan;

  @override
  List<Object?> get props => [from, to, plan];
}

class SettingsState extends Equatable {
  const SettingsState({
    this.defaultAgent,
    this.validatorCommand,
    this.terminal = EmbeddedTerminalSettings.defaults,
    this.contextStorageMode,
    this.contextStorageCustomPath,
    this.resolvedContextDir,
    this.contextStorageError,
    this.copyOffer,
  });

  final String? defaultAgent;
  final String? validatorCommand;
  final EmbeddedTerminalSettings terminal;

  /// The effective (resolved) storage mode for the active project.
  final ContextStorageMode? contextStorageMode;

  /// The custom directory when [contextStorageMode] is the custom path mode.
  final String? contextStorageCustomPath;

  /// The absolute resolved context directory shown to the user.
  final String? resolvedContextDir;

  /// Surfaced when a storage switch failed validation (e.g. a non-marker
  /// `.pickforge/`). The override is NOT persisted in this case.
  final String? contextStorageError;

  /// Set after a successful switch when the previous location still has data.
  final ContextStorageCopyOffer? copyOffer;

  @override
  List<Object?> get props => [
        defaultAgent,
        validatorCommand,
        terminal,
        contextStorageMode,
        contextStorageCustomPath,
        resolvedContextDir,
        contextStorageError,
        copyOffer,
      ];

  SettingsState copyWith({
    String? defaultAgent,
    Object? validatorCommand = _unset,
    EmbeddedTerminalSettings? terminal,
    ContextStorageMode? contextStorageMode,
    Object? contextStorageCustomPath = _unset,
    String? resolvedContextDir,
    Object? contextStorageError = _unset,
    Object? copyOffer = _unset,
  }) =>
      SettingsState(
        defaultAgent: defaultAgent ?? this.defaultAgent,
        validatorCommand: validatorCommand == _unset
            ? this.validatorCommand
            : validatorCommand as String?,
        terminal: terminal ?? this.terminal,
        contextStorageMode: contextStorageMode ?? this.contextStorageMode,
        contextStorageCustomPath: contextStorageCustomPath == _unset
            ? this.contextStorageCustomPath
            : contextStorageCustomPath as String?,
        resolvedContextDir: resolvedContextDir ?? this.resolvedContextDir,
        contextStorageError: contextStorageError == _unset
            ? this.contextStorageError
            : contextStorageError as String?,
        copyOffer: copyOffer == _unset
            ? this.copyOffer
            : copyOffer as ContextStorageCopyOffer?,
      );
}

const _unset = Object();

@injectable
class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit(
    this._repo,
    this._terminalRepo,
    this._storage,
    this._migrator,
  ) : super(const SettingsState());

  final ProjectSettingsRepository _repo;
  final EmbeddedTerminalSettingsRepository _terminalRepo;
  final ContextStorageService _storage;
  final ContextStorageMigrator _migrator;
  int _loadGeneration = 0;

  Future<void> load(String projectRoot) async {
    final generation = ++_loadGeneration;
    final results = await Future.wait<Object?>([
      _repo.getDefaultAgentId(projectRoot),
      _repo.getValidatorCommand(projectRoot),
      _terminalRepo.load(),
      _storage.resolve(projectRoot),
    ]);
    if (isClosed || generation != _loadGeneration) return;
    final agent = results[0] as String?;
    final validatorCommand = results[1] as String?;
    final terminal = results[2]! as EmbeddedTerminalSettings;
    final resolved = results[3]! as ResolvedContextDirectory;
    emit(
      SettingsState(
        defaultAgent: agent,
        validatorCommand: validatorCommand,
        terminal: terminal,
        contextStorageMode: resolved.storageLocation.mode,
        contextStorageCustomPath: resolved.storageLocation.customPath,
        resolvedContextDir: resolved.contextDir,
      ),
    );
  }

  Future<void> setDefaultAgent(String projectRoot, String id) async {
    await _repo.setDefaultAgentId(projectRoot, id);
    emit(state.copyWith(defaultAgent: id));
  }

  Future<void> setValidatorCommand(String projectRoot, String? command) async {
    final trimmed = command?.trim();
    final normalized = trimmed == null || trimmed.isEmpty ? null : trimmed;
    await _repo.setValidatorCommand(projectRoot, normalized);
    emit(state.copyWith(validatorCommand: normalized));
  }

  Future<void> setTerminal(EmbeddedTerminalSettings terminal) async {
    await _terminalRepo.save(terminal);
    emit(state.copyWith(terminal: terminal));
  }

  /// Switch the project's storage location. Validates the choice via
  /// `ensure` BEFORE persisting — a project-local choice on a non-marker
  /// `.pickforge/` throws, in which case the error is surfaced and nothing is
  /// persisted. On success the override is persisted and, when the previous
  /// location still holds data, a copy offer is exposed for confirmation.
  Future<void> setContextStorageLocation(
    String projectRoot,
    ContextStorageLocation location,
  ) async {
    final ResolvedContextDirectory oldResolved;
    try {
      oldResolved = await _storage.resolve(projectRoot);
    } on Object catch (error) {
      if (isClosed) return;
      emit(state.copyWith(contextStorageError: error.toString()));
      return;
    }

    final ResolvedContextDirectory newResolved;
    try {
      // Validate the new location first; never persist on failure.
      newResolved = await _storage.ensure(projectRoot, location: location);
    } on Object catch (error) {
      if (isClosed) return;
      emit(state.copyWith(contextStorageError: error.toString()));
      return;
    }

    await _repo.setContextStorageLocation(projectRoot, location);
    if (isClosed) return;

    final plan = oldResolved.contextDir == newResolved.contextDir
        ? const StorageCopyPlan(
            chatCount: 0,
            runCount: 0,
            hasContextFiles: false,
            pasteCount: 0,
            skillCount: 0,
            promptTemplateCount: 0,
          )
        : _migrator.plan(oldResolved);
    emit(
      state.copyWith(
        contextStorageMode: location.mode,
        contextStorageCustomPath: location.customPath,
        resolvedContextDir: newResolved.contextDir,
        contextStorageError: null,
        copyOffer: plan.isEmpty
            ? null
            : ContextStorageCopyOffer(
                from: oldResolved,
                to: newResolved,
                plan: plan,
              ),
      ),
    );
  }

  /// Run the pending copy from the [ContextStorageCopyOffer]. Originals are
  /// always retained. Clears the offer afterwards.
  Future<void> confirmCopy() async {
    final offer = state.copyOffer;
    if (offer == null) return;
    await _migrator.copy(offer.from, offer.to);
    if (isClosed) return;
    emit(state.copyWith(copyOffer: null));
  }

  /// Dismiss the copy offer without copying.
  void dismissCopyOffer() {
    if (state.copyOffer == null) return;
    emit(state.copyWith(copyOffer: null));
  }

  /// Clear a surfaced storage error (e.g. after showing it to the user).
  void clearContextStorageError() {
    if (state.contextStorageError == null) return;
    emit(state.copyWith(contextStorageError: null));
  }
}
