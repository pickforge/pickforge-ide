import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/context_attachment_renderer.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/skills/skill_store.dart';

class PreparedContext {
  PreparedContext({required this.written, required this.initialPrompt});

  final WrittenContext written;
  final String initialPrompt;
}

class ForgeContextPreview {
  ForgeContextPreview({
    required this.skillMarkdown,
    required this.widgetContextMarkdown,
    required this.initialPrompt,
  });

  final String skillMarkdown;
  final String widgetContextMarkdown;
  final String initialPrompt;
}

/// Renders Pickforge context for an agent session.
///
/// Earlier this class also spawned a terminal; PTY hosting now lives in the
/// embedded terminal subsystem. `prepareContext` writes `.pickforge/` files
/// and returns the prompt the embedded session should send to the agent.
class AgentLauncher {
  AgentLauncher({
    required this.agentRegistry,
    required this.contextWriter,
    required this.skillStore,
    required this.widgetRenderer,
    this.attachmentRenderer = const ContextAttachmentRenderer(),
  });

  final AgentProfileRegistry agentRegistry;
  final PickforgeContextWriter contextWriter;
  final SkillStore skillStore;
  final WidgetContextRenderer widgetRenderer;
  final ContextAttachmentRenderer attachmentRenderer;

  Future<ForgeContextPreview> buildPreview(ForgeRequest req) async {
    final agent = agentRegistry.get(req.agentId);
    final skillContent = await skillStore.loadSkill(
      req.skill,
      projectRoot: req.projectRoot,
    );
    final attachments = await attachmentRenderer.render(
      projectRoot: req.projectRoot,
      paths: req.attachmentPaths,
    );
    final customNote = _renderCustomNote(req.customNote);
    final widgetContext =
        '${widgetRenderer.render(req.widget)}$attachments$customNote';

    final hasDeviceScreen = req.widget.adbScreenshotPath != null;
    final initialPrompt = _withVisualSelfCheck(
      agent.buildInitialPrompt(
        pickforgeDirRelative: '.pickforge',
        skillFilename: 'skill-active.md',
        widgetContextFilename: 'widget-context.md',
        screenshotFilename:
            req.widget.screenshotPath != null ? 'screenshot.png' : null,
        deviceScreenFilename:
            hasDeviceScreen ? AdbScreenshotCapturer.defaultOutputName : null,
      ),
      enabled: hasDeviceScreen,
    );

    return ForgeContextPreview(
      skillMarkdown: skillContent,
      widgetContextMarkdown: widgetContext,
      initialPrompt: initialPrompt,
    );
  }

  Future<PreparedContext> prepareContext(
    ForgeRequest req, {
    String? initialPromptOverride,
  }) async {
    final preview = await buildPreview(req);
    final override = initialPromptOverride?.trim();
    final initialPrompt =
        override == null || override.isEmpty ? preview.initialPrompt : override;

    final written = await contextWriter.write(
      projectRoot: req.projectRoot,
      skillMarkdown: preview.skillMarkdown,
      widgetContextMarkdown: preview.widgetContextMarkdown,
      initialPrompt: initialPrompt,
    );

    return PreparedContext(
      written: written,
      initialPrompt: initialPrompt,
    );
  }

  String _renderCustomNote(String note) {
    final trimmed = note.trim();
    if (trimmed.isEmpty) return '';
    return '\n## Custom Notes\n\n'
        '${attachmentRenderer.redactor.redact(trimmed)}\n';
  }

  String _withVisualSelfCheck(String prompt, {required bool enabled}) {
    if (!enabled) return prompt;
    return '$prompt\n\n'
        'Visual self-check: if `.pickforge/ipc.sock-path` exists after editing, '
        'use the Pickforge IPC `hot_reload` method when possible. Pickforge '
        'will write `${AdbScreenshotCapturer.afterHotReloadOutputName}` after '
        'a successful reload; compare it with '
        '`${AdbScreenshotCapturer.defaultOutputName}` before reporting visual '
        'success.';
  }
}
