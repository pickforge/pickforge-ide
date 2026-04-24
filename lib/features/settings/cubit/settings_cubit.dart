import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';

class SettingsState extends Equatable {
  const SettingsState({this.defaultAgent, this.defaultTerminal});

  final String? defaultAgent;
  final String? defaultTerminal;

  @override
  List<Object?> get props => [defaultAgent, defaultTerminal];

  SettingsState copyWith({String? defaultAgent, String? defaultTerminal}) =>
      SettingsState(
        defaultAgent: defaultAgent ?? this.defaultAgent,
        defaultTerminal: defaultTerminal ?? this.defaultTerminal,
      );
}

@injectable
class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit(this._repo) : super(const SettingsState());

  final ProjectSettingsRepository _repo;

  Future<void> load(String projectRoot) async {
    final agent = await _repo.getDefaultAgentId(projectRoot);
    final terminal = await _repo.getDefaultTerminalId(projectRoot);
    emit(SettingsState(defaultAgent: agent, defaultTerminal: terminal));
  }

  Future<void> setDefaultAgent(String projectRoot, String id) async {
    await _repo.setDefaultAgentId(projectRoot, id);
    emit(state.copyWith(defaultAgent: id));
  }

  Future<void> setDefaultTerminal(String projectRoot, String id) async {
    await _repo.setDefaultTerminalId(projectRoot, id);
    emit(state.copyWith(defaultTerminal: id));
  }
}
