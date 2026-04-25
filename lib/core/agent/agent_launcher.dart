import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/skills/skill_store.dart';

class PreparedContext {
  PreparedContext({required this.written, required this.initialPrompt});

  final WrittenContext written;
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
  });

  final AgentProfileRegistry agentRegistry;
  final PickforgeContextWriter contextWriter;
  final SkillStore skillStore;
  final WidgetContextRenderer widgetRenderer;

  Future<PreparedContext> prepareContext(ForgeRequest req) async {
    final agent = agentRegistry.get(req.agentId);
    final skillContent = await skillStore.loadSkill(
      req.skill,
      projectRoot: req.projectRoot,
    );
    final widgetContext = widgetRenderer.render(req.widget);

    final initialPrompt = agent.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename:
          req.widget.screenshotPath != null ? 'screenshot.png' : null,
      deviceScreenFilename:
          req.widget.adbScreenshotPath != null ? 'device-screen.png' : null,
    );

    final written = await contextWriter.write(
      projectRoot: req.projectRoot,
      skillMarkdown: skillContent,
      widgetContextMarkdown: widgetContext,
      initialPrompt: initialPrompt,
    );

    return PreparedContext(written: written, initialPrompt: initialPrompt);
  }
}
