import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/skills/skill_store.dart';

class _MockAgentProfile extends Mock implements AgentProfile {}

class _MockAgentProfileRegistry extends Mock implements AgentProfileRegistry {}

class _MockSkillStore extends Mock implements SkillStore {}

class _MockWidgetContextRenderer extends Mock
    implements WidgetContextRenderer {}

const _fallbackWidget = SelectedWidget(
  node: WidgetNode(
    id: '',
    className: '',
    children: [],
    creationLocation: null,
  ),
  ancestorClasses: [],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

void main() {
  late _MockAgentProfileRegistry mockAgentRegistry;
  late _MockSkillStore mockSkillStore;
  late _MockWidgetContextRenderer mockWidgetRenderer;
  late _MockAgentProfile mockAgent;
  late PickforgeContextWriter writer;
  late AgentLauncher launcher;

  setUpAll(() {
    registerFallbackValue(SkillId.editWidget);
    registerFallbackValue(_fallbackWidget);
  });

  setUp(() {
    mockAgentRegistry = _MockAgentProfileRegistry();
    mockSkillStore = _MockSkillStore();
    mockWidgetRenderer = _MockWidgetContextRenderer();
    mockAgent = _MockAgentProfile();
    writer = PickforgeContextWriter();

    when(() => mockAgentRegistry.get(AgentProfileId.opencode))
        .thenReturn(mockAgent);
    when(() => mockAgent.projectContextFile).thenReturn('AGENTS.md');
    when(
      () => mockSkillStore.loadSkill(
        any(),
        projectRoot: any(named: 'projectRoot'),
      ),
    ).thenAnswer((_) async => '# Skill');
    when(
      () => mockSkillStore.loadPromptTemplate(
        agentId: any(named: 'agentId'),
        skill: any(named: 'skill'),
        projectRoot: any(named: 'projectRoot'),
      ),
    ).thenAnswer((_) async => '{{read_files_numbered}}');
    when(() => mockWidgetRenderer.render(any())).thenReturn('# Widget');

    launcher = AgentLauncher(
      agentRegistry: mockAgentRegistry,
      contextWriter: writer,
      skillStore: mockSkillStore,
      widgetRenderer: mockWidgetRenderer,
    );
  });

  test('prepareContext writes context files and returns paths + prompt',
      () async {
    final tempDir = Directory.systemTemp.createTempSync('agent_launcher_test_');
    try {
      final req = ForgeRequest(
        agentId: AgentProfileId.opencode,
        skill: SkillId.editWidget,
        widget: const SelectedWidget(
          node: WidgetNode(
            id: 'w-1',
            className: 'MyWidget',
            children: [],
            creationLocation: null,
          ),
          ancestorClasses: ['MaterialApp'],
          sourceSnippet: null,
          screenshotPath: null,
          adbScreenshotPath: null,
          propertiesJson: {},
        ),
        terminalId: 'unused',
        projectRoot: tempDir.path,
      );

      final ctx = await launcher.prepareContext(req);

      expect(
        ctx.initialPrompt,
        '1. Read .pickforge/skill-active.md\n'
        '2. Read .pickforge/widget-context.md',
      );
      expect(ctx.written.skillPath, endsWith('skill-active.md'));
      expect(ctx.written.widgetContextPath, endsWith('widget-context.md'));
      expect(ctx.written.initialPromptPath, endsWith('initial-prompt.md'));
      expect(File(ctx.written.skillPath).readAsStringSync(), '# Skill');
      expect(
        File(ctx.written.widgetContextPath).readAsStringSync(),
        '# Widget',
      );
      expect(
        File(ctx.written.initialPromptPath).readAsStringSync(),
        '1. Read .pickforge/skill-active.md\n'
        '2. Read .pickforge/widget-context.md',
      );
    } finally {
      tempDir.deleteSync(recursive: true);
    }
  });

  test(
      'prepareContext writes edited final instruction without changing context',
      () async {
    final tempDir = Directory.systemTemp.createTempSync('agent_launcher_test_');
    try {
      final req = ForgeRequest(
        agentId: AgentProfileId.opencode,
        skill: SkillId.editWidget,
        widget: const SelectedWidget(
          node: WidgetNode(
            id: 'w-1',
            className: 'MyWidget',
            children: [],
            creationLocation: null,
          ),
          ancestorClasses: ['MaterialApp'],
          sourceSnippet: null,
          screenshotPath: null,
          adbScreenshotPath: null,
          propertiesJson: {},
        ),
        terminalId: 'unused',
        projectRoot: tempDir.path,
      );

      final ctx = await launcher.prepareContext(
        req,
        initialPromptOverride: 'Use this edited instruction.',
      );

      expect(ctx.initialPrompt, 'Use this edited instruction.');
      expect(File(ctx.written.skillPath).readAsStringSync(), '# Skill');
      expect(
        File(ctx.written.widgetContextPath).readAsStringSync(),
        '# Widget',
      );
      expect(
        File(ctx.written.initialPromptPath).readAsStringSync(),
        'Use this edited instruction.',
      );
    } finally {
      tempDir.deleteSync(recursive: true);
    }
  });

  test('prepareContext includes inspector and device screenshot filenames',
      () async {
    final tempDir = Directory.systemTemp.createTempSync('agent_launcher_test_');
    try {
      final req = ForgeRequest(
        agentId: AgentProfileId.opencode,
        skill: SkillId.editWidget,
        widget: SelectedWidget(
          node: const WidgetNode(
            id: 'w-1',
            className: 'MyWidget',
            children: [],
            creationLocation: null,
          ),
          ancestorClasses: const ['MaterialApp'],
          sourceSnippet: null,
          screenshotPath: '${tempDir.path}/.pickforge/screenshot.png',
          adbScreenshotPath: '${tempDir.path}/.pickforge/device-screen.png',
          propertiesJson: const {},
        ),
        terminalId: 'unused',
        projectRoot: tempDir.path,
      );

      final ctx = await launcher.prepareContext(req);

      verify(
        () => mockSkillStore.loadPromptTemplate(
          agentId: 'opencode',
          skill: SkillId.editWidget,
          projectRoot: tempDir.path,
        ),
      ).called(1);
      expect(ctx.initialPrompt, contains('3. Read .pickforge/screenshot.png'));
      expect(
        ctx.initialPrompt,
        contains('4. Read .pickforge/device-screen.png'),
      );
      expect(ctx.initialPrompt, contains('Visual self-check'));
      expect(
        ctx.initialPrompt,
        contains(AdbScreenshotCapturer.afterHotReloadOutputName),
      );
      expect(
        File(ctx.written.initialPromptPath).readAsStringSync(),
        contains(AdbScreenshotCapturer.afterHotReloadOutputName),
      );
    } finally {
      tempDir.deleteSync(recursive: true);
    }
  });

  test('prepareContext appends redacted custom notes', () async {
    final tempDir = Directory.systemTemp.createTempSync('agent_launcher_test_');
    try {
      final req = ForgeRequest(
        agentId: AgentProfileId.opencode,
        skill: SkillId.editWidget,
        widget: const SelectedWidget(
          node: WidgetNode(
            id: 'w-1',
            className: 'MyWidget',
            children: [],
            creationLocation: null,
          ),
          ancestorClasses: ['MaterialApp'],
          sourceSnippet: null,
          screenshotPath: null,
          adbScreenshotPath: null,
          propertiesJson: {},
        ),
        terminalId: 'unused',
        projectRoot: tempDir.path,
        customNote: 'token=secret\nMake it denser.',
      );

      final ctx = await launcher.prepareContext(req);
      final widgetContext =
          File(ctx.written.widgetContextPath).readAsStringSync();

      expect(widgetContext, contains('## Custom Notes'));
      expect(widgetContext, contains('token=[REDACTED]'));
      expect(widgetContext, contains('Make it denser.'));
      expect(widgetContext, isNot(contains('secret')));
    } finally {
      tempDir.deleteSync(recursive: true);
    }
  });
}
