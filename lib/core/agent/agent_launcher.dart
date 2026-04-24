import 'dart:io';

import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';

/// Function type for spawning a process — abstracted for testing.
typedef ProcessSpawner = Future<Process> Function(
  String executable,
  List<String> arguments, {
  String? workingDirectory,
  Map<String, String>? environment,
});

/// Orchestrates launching an AI agent in a terminal with Pickforge context.
///
/// NOT annotated with `@lazySingleton` — wired via `@module` in injection.dart
/// because of the optional `processSpawner` parameter.
class AgentLauncher {
  AgentLauncher({
    required this.agentRegistry,
    required this.terminalRegistry,
    required this.dirManager,
    required this.skillStore,
    required this.widgetRenderer,
    required this.scriptGenerator,
    ProcessSpawner? processSpawner,
  }) : _processSpawner = processSpawner ?? Process.start;

  final AgentProfileRegistry agentRegistry;
  final TerminalProfileRegistry terminalRegistry;
  final PickforgeDirManager dirManager;
  final SkillStore skillStore;
  final WidgetContextRenderer widgetRenderer;
  final WrapperScriptGenerator scriptGenerator;
  final ProcessSpawner _processSpawner;

  /// Launches an agent session for the given [req].
  ///
  /// 1. Resolve agent + terminal from registries
  /// 2. Ensure `.pickforge/` dir exists
  /// 3. Load skill from SkillStore
  /// 4. Render widget context
  /// 5. Write context files to `.pickforge/`
  /// 6. Build initial prompt and write to `.pickforge/initial-prompt.md`
  /// 7. Generate wrapper script and write to `.pickforge/wrapper.{sh,bat}`
  /// 8. chmod +x the script on Unix
  /// 9. Build terminal invocation spec
  /// 10. Spawn terminal process
  Future<void> launch(ForgeRequest req) async {
    // 1. Resolve agent + terminal
    final agent = agentRegistry.get(req.agentId);
    final terminal = terminalRegistry.get(req.terminalId);
    if (terminal == null) {
      throw StateError('No terminal profile registered for ${req.terminalId}');
    }

    // 2. Ensure .pickforge/ dir
    await dirManager.ensure(projectRoot: req.projectRoot);

    // 3. Load skill
    final skillContent = await skillStore.loadSkill(
      req.skill,
      projectRoot: req.projectRoot,
    );

    // 4. Render widget context
    final widgetContext = widgetRenderer.render(req.widget);

    // 5. Write context files
    await dirManager.writeContext(
      projectRoot: req.projectRoot,
      skillContent: skillContent,
      widgetContextContent: widgetContext,
      runLogContent: '{"runs": []}',
    );

    // 6. Build initial prompt
    const pickforgeDirRelative = '.pickforge';
    final skillFilename = '${req.skill.value}.md';
    const widgetContextFilename = 'widget-context.md';
    final screenshotFilename =
        req.widget.screenshotPath != null ? 'screenshot.png' : null;
    final deviceScreenFilename =
        req.widget.adbScreenshotPath != null ? 'device-screen.png' : null;

    final initialPrompt = agent.buildInitialPrompt(
      pickforgeDirRelative: pickforgeDirRelative,
      skillFilename: skillFilename,
      widgetContextFilename: widgetContextFilename,
      screenshotFilename: screenshotFilename,
      deviceScreenFilename: deviceScreenFilename,
    );

    final promptFile = File('${req.projectRoot}/.pickforge/initial-prompt.md');
    await promptFile.writeAsString(initialPrompt);

    // 7. Generate wrapper script
    final isWindows = Platform.isWindows;
    final scriptExt = isWindows ? 'bat' : 'sh';
    final scriptPath = '${req.projectRoot}/.pickforge/wrapper.$scriptExt';
    const promptPath = '.pickforge/initial-prompt.md';

    final scriptContent = isWindows
        ? scriptGenerator.windows(
            projectRoot: req.projectRoot,
            agentBinary: agent.binary,
            args: agent.invocationArgs(),
            promptPath: promptPath,
          )
        : scriptGenerator.unix(
            projectRoot: req.projectRoot,
            agentBinary: agent.binary,
            args: agent.invocationArgs(),
            promptPath: promptPath,
          );

    await File(scriptPath).writeAsString(scriptContent);

    // 8. chmod +x on Unix
    if (!isWindows) {
      await Process.run('chmod', ['+x', scriptPath]);
    }

    // 9. Build terminal invocation spec
    final launchSpec = TerminalLaunchSpec(
      id: TerminalProfileId.fromValue(req.terminalId),
      scriptPath: scriptPath,
      workingDir: req.projectRoot,
      env: {},
    );
    final invocation = terminal.buildInvocation(launchSpec);

    // 10. Spawn terminal process
    await _processSpawner(
      invocation.binary,
      invocation.arguments,
      workingDirectory: req.projectRoot,
    );
  }
}
