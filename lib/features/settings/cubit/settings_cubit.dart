import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';

class SettingsState extends Equatable {
  const SettingsState({
    this.defaultAgent,
    this.validatorCommand,
    this.terminal = EmbeddedTerminalSettings.defaults,
  });

  final String? defaultAgent;
  final String? validatorCommand;
  final EmbeddedTerminalSettings terminal;

  @override
  List<Object?> get props => [defaultAgent, validatorCommand, terminal];

  SettingsState copyWith({
    String? defaultAgent,
    Object? validatorCommand = _unset,
    EmbeddedTerminalSettings? terminal,
  }) =>
      SettingsState(
        defaultAgent: defaultAgent ?? this.defaultAgent,
        validatorCommand: validatorCommand == _unset
            ? this.validatorCommand
            : validatorCommand as String?,
        terminal: terminal ?? this.terminal,
      );
}

const _unset = Object();

@injectable
class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit(this._repo, this._terminalRepo) : super(const SettingsState());

  final ProjectSettingsRepository _repo;
  final EmbeddedTerminalSettingsRepository _terminalRepo;
  int _loadGeneration = 0;

  Future<void> load(String projectRoot) async {
    final generation = ++_loadGeneration;
    final results = await Future.wait<Object?>([
      _repo.getDefaultAgentId(projectRoot),
      _repo.getValidatorCommand(projectRoot),
      _terminalRepo.load(),
    ]);
    if (isClosed || generation != _loadGeneration) return;
    final agent = results[0] as String?;
    final validatorCommand = results[1] as String?;
    final terminal = results[2]! as EmbeddedTerminalSettings;
    emit(
      SettingsState(
        defaultAgent: agent,
        validatorCommand: validatorCommand,
        terminal: terminal,
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
}
