import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/agent/models/forge_request.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

@injectable
class ForgeCubit extends Cubit<ForgeState> {
  ForgeCubit(this._launcher, this._adb) : super(ForgeState.initial());

  final AgentLauncher _launcher;
  final AdbScreenshotCapturer _adb;

  void selectSkill(SkillId skill) {
    emit(state.copyWith(skill: skill));
  }

  void selectAgent(AgentProfileId agentId) {
    emit(state.copyWith(agentId: agentId));
  }

  void selectTerminal(String terminalId) {
    emit(state.copyWith(terminalId: terminalId));
  }

  Future<void> forge({
    required SelectedWidget selection,
    required String projectRoot,
  }) async {
    emit(state.copyWith(launching: true, lastError: null));
    try {
      final adbPath = await _adb.capture(
        outputDir: '$projectRoot/.pickforge',
      );

      final enriched = adbPath != null
          ? selection.copyWith(adbScreenshotPath: adbPath)
          : selection;

      final req = ForgeRequest(
        widget: enriched,
        skill: state.skill,
        agentId: state.agentId,
        terminalId: state.terminalId,
        projectRoot: projectRoot,
      );

      await _launcher.launch(req);
      emit(state.copyWith(launching: false));
    } on Object catch (e) {
      emit(state.copyWith(launching: false, lastError: e.toString()));
    }
  }
}
