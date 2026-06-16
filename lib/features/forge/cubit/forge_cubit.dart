import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/headless/chat_prompt_dispatcher.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/agent/models/forge_request.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

@injectable
class ForgeCubit extends Cubit<ForgeState> {
  ForgeCubit(this._launcher, this._adb, this._pool, this._storage)
      : super(ForgeState.initial());

  final AgentLauncher _launcher;
  final AdbScreenshotCapturer _adb;
  final PtySessionPool _pool;
  final ContextStorageService _storage;

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
    required String chatId,
    List<String> attachmentPaths = const [],
    String customNote = '',
    String? deviceSerial,
    String? devicePlatform,
    String? initialPromptOverride,
  }) async {
    if (!const ForgeEligibilityPolicy().canForge(selection, projectRoot)) {
      emit(
        state.copyWith(
          launching: false,
          lastError: 'Pick a widget from the active project source.',
        ),
      );
      return;
    }

    emit(state.copyWith(launching: true, lastError: null));
    try {
      final resolved = await _storage.resolve(projectRoot);
      final adbPath = await _adb.capture(
        outputDir: resolved.contextDir,
        isProjectLocal: resolved.isProjectLocal,
        serial: deviceSerial,
        platform: devicePlatform,
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
        attachmentPaths: attachmentPaths,
        customNote: customNote,
      );

      final ctx = initialPromptOverride == null
          ? await _launcher.prepareContext(req)
          : await _launcher.prepareContext(
              req,
              initialPromptOverride: initialPromptOverride,
            );
      _sendPrompt(
        agentId: state.agentId,
        chatId: chatId,
        projectRoot: projectRoot,
        prompt: ctx.initialPrompt,
      );
      emit(state.copyWith(launching: false));
    } on Object catch (e) {
      _recordAgentFailure('Forge failed: $e');
      emit(state.copyWith(launching: false, lastError: e.toString()));
    }
  }

  Future<ForgeContextPreview> preview({
    required SelectedWidget selection,
    required String projectRoot,
    List<String> attachmentPaths = const [],
    String customNote = '',
  }) {
    return _launcher.buildPreview(
      ForgeRequest(
        widget: selection,
        skill: state.skill,
        agentId: state.agentId,
        terminalId: state.terminalId,
        projectRoot: projectRoot,
        attachmentPaths: attachmentPaths,
        customNote: customNote,
      ),
    );
  }

  void _recordAgentFailure(String message) {
    if (getIt.isRegistered<DiagnosticsService>()) {
      getIt<DiagnosticsService>().recordAgentError(message);
    }
  }

  void _sendPrompt({
    required AgentProfileId agentId,
    required String chatId,
    required String projectRoot,
    required String prompt,
  }) {
    if (getIt.isRegistered<ChatPromptDispatcher>()) {
      getIt<ChatPromptDispatcher>().sendPrompt(
        agentId: agentId,
        chatId: chatId,
        projectRoot: projectRoot,
        prompt: prompt,
      );
      return;
    }
    // Paste, don't submit: the embedded terminal runs the user's shell, and
    // whatever is foregrounded (shell prompt or agent TUI) must not execute
    // a prose prompt on its own.
    _pool.paste(chatId, prompt);
  }
}
