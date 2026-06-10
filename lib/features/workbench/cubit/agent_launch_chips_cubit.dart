import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/features/workbench/cubit/agent_launch_chips_state.dart';

class AgentLaunchChipsCubit extends Cubit<AgentLaunchChipsState> {
  AgentLaunchChipsCubit(
    this._registry,
    this._detector,
    this._modelSettings,
    this._projectSettings,
  ) : super(const AgentLaunchChipsState());

  final AgentProfileRegistry _registry;
  final BinaryDetector _detector;
  final AgentModelSettingsRepository? _modelSettings;
  final ProjectSettingsRepository _projectSettings;

  Future<void> load({
    required String projectRoot,
    required String chatAgentId,
  }) async {
    final profiles = _registry.all();
    final availability = await Future.wait(
      profiles.map((p) => _detector.isBinaryOnPath(p.binary)),
    );
    final emphasizedId =
        await _projectSettings.getDefaultAgentId(projectRoot) ?? chatAgentId;
    if (isClosed) return;

    final chips = [
      for (var i = 0; i < profiles.length; i++)
        AgentLaunchChip(
          id: profiles[i].id,
          label: profiles[i].displayName,
          command: profiles[i].launchCommand(
            model: _modelSettings?.modelFor(profiles[i].id),
          ),
          available: availability[i],
          emphasized: profiles[i].id.value == emphasizedId,
          binary: profiles[i].binary,
        ),
    ];
    // Stable partition: emphasized first, registry order otherwise.
    final ordered = [
      ...chips.where((c) => c.emphasized),
      ...chips.where((c) => !c.emphasized),
    ];

    emit(AgentLaunchChipsState(chips: ordered, loaded: true));
  }
}
