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
    when(
      () => mockAgent.buildInitialPrompt(
        pickforgeDirRelative: any(named: 'pickforgeDirRelative'),
        skillFilename: any(named: 'skillFilename'),
        widgetContextFilename: any(named: 'widgetContextFilename'),
        screenshotFilename: any(named: 'screenshotFilename'),
        deviceScreenFilename: any(named: 'deviceScreenFilename'),
      ),
    ).thenReturn('1. Read skill\n2. Read widget');
    when(
      () => mockSkillStore.loadSkill(
        any(),
        projectRoot: any(named: 'projectRoot'),
      ),
    ).thenAnswer((_) async => '# Skill');
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

      expect(ctx.initialPrompt, '1. Read skill\n2. Read widget');
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
        '1. Read skill\n2. Read widget',
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
        () => mockAgent.buildInitialPrompt(
          pickforgeDirRelative: '.pickforge',
          skillFilename: 'skill-active.md',
          widgetContextFilename: 'widget-context.md',
          screenshotFilename: 'screenshot.png',
          deviceScreenFilename: 'device-screen.png',
        ),
      ).called(1);
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
