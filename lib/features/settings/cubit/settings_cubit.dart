import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';

class SettingsState extends Equatable {
  const SettingsState({this.defaultAgent});

  final String? defaultAgent;

  @override
  List<Object?> get props => [defaultAgent];

  SettingsState copyWith({String? defaultAgent}) =>
      SettingsState(defaultAgent: defaultAgent ?? this.defaultAgent);
}

@injectable
class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit(this._repo) : super(const SettingsState());

  final ProjectSettingsRepository _repo;

  Future<void> load(String projectRoot) async {
    final agent = await _repo.getDefaultAgentId(projectRoot);
    emit(SettingsState(defaultAgent: agent));
  }

  Future<void> setDefaultAgent(String projectRoot, String id) async {
    await _repo.setDefaultAgentId(projectRoot, id);
    emit(state.copyWith(defaultAgent: id));
  }
}
