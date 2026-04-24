import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';

class _MockAgentProfile extends Mock implements AgentProfile {}

class _MockTerminalProfile extends Mock implements TerminalProfile {}

class _MockAgentProfileRegistry extends Mock implements AgentProfileRegistry {}

class _MockTerminalProfileRegistry extends Mock
    implements TerminalProfileRegistry {}

class _MockSkillStore extends Mock implements SkillStore {}

class _MockWidgetContextRenderer extends Mock
    implements WidgetContextRenderer {}

class _MockWrapperScriptGenerator extends Mock
    implements WrapperScriptGenerator {}

class _FakeTerminalLaunchSpec extends Fake implements TerminalLaunchSpec {}

class _MockProcess extends Mock implements Process {}

Future<Process> _fakeSpawner(
  String _,
  List<String> __, {
  String? workingDirectory,
  Map<String, String>? environment,
}) async =>
    _MockProcess();

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
  late _MockTerminalProfileRegistry mockTerminalRegistry;
  late _MockSkillStore mockSkillStore;
  late _MockWidgetContextRenderer mockWidgetRenderer;
  late _MockWrapperScriptGenerator mockScriptGenerator;
  late _MockAgentProfile mockAgent;
  late _MockTerminalProfile mockTerminal;
  late AgentLauncher launcher;

  setUpAll(() {
    registerFallbackValue(_FakeTerminalLaunchSpec());
    registerFallbackValue(SkillId.editWidget);
    registerFallbackValue(_fallbackWidget);
  });

  setUp(() {
    mockAgentRegistry = _MockAgentProfileRegistry();
    mockTerminalRegistry = _MockTerminalProfileRegistry();
    mockSkillStore = _MockSkillStore();
    mockWidgetRenderer = _MockWidgetContextRenderer();
    mockScriptGenerator = _MockWrapperScriptGenerator();
    mockAgent = _MockAgentProfile();
    mockTerminal = _MockTerminalProfile();

    when(() => mockAgentRegistry.get(AgentProfileId.opencode))
        .thenReturn(mockAgent);
    when(() => mockTerminalRegistry.get('ghostty')).thenReturn(mockTerminal);
    when(() => mockAgent.binary).thenReturn('opencode');
    when(() => mockAgent.invocationArgs()).thenReturn(['--yolo']);
    when(
      () => mockAgent.buildInitialPrompt(
        pickforgeDirRelative: any(named: 'pickforgeDirRelative'),
        skillFilename: any(named: 'skillFilename'),
        widgetContextFilename: any(named: 'widgetContextFilename'),
        screenshotFilename: any(named: 'screenshotFilename'),
        deviceScreenFilename: any(named: 'deviceScreenFilename'),
      ),
    ).thenReturn('1. Read skill\n2. Read widget');
    when(() => mockTerminal.buildInvocation(any())).thenReturn(
      const LaunchInvocation(
        binary: 'ghostty',
        arguments: ['-e', '/path/wrapper.sh'],
      ),
    );
    when(
      () => mockSkillStore.loadSkill(
        any(),
        projectRoot: any(named: 'projectRoot'),
      ),
    ).thenAnswer((_) async => '# Skill');
    when(() => mockWidgetRenderer.render(any())).thenReturn('# Widget');
    when(
      () => mockScriptGenerator.unix(
        projectRoot: any(named: 'projectRoot'),
        agentBinary: any(named: 'agentBinary'),
        args: any(named: 'args'),
        promptPath: any(named: 'promptPath'),
      ),
    ).thenReturn('cd /p && opencode --yolo < .pickforge/initial-prompt.md');

    launcher = AgentLauncher(
      agentRegistry: mockAgentRegistry,
      terminalRegistry: mockTerminalRegistry,
      dirManager: PickforgeDirManager(),
      skillStore: mockSkillStore,
      widgetRenderer: mockWidgetRenderer,
      scriptGenerator: mockScriptGenerator,
      processSpawner: _fakeSpawner,
    );
  });

  test('launch writes context files and initial prompt to .pickforge/',
      () async {
    final tempDir = Directory.systemTemp.createTempSync('agent_launcher_test_');
    try {
      final req = const ForgeRequest(
        agentId: AgentProfileId.opencode,
        skill: SkillId.editWidget,
        widget: SelectedWidget(
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
        terminalId: 'ghostty',
        projectRoot: '/tmp/test',
      ).copyWith(projectRoot: tempDir.path);

      await launcher.launch(req);

      final dir = Directory('${tempDir.path}/.pickforge');
      expect(dir.existsSync(), isTrue);
      for (final name in [
        'skill-active.md',
        'widget-context.md',
        'run-log.json',
        'initial-prompt.md',
        'wrapper.sh',
      ]) {
        expect(File('${dir.path}/$name').existsSync(), isTrue, reason: name);
      }
    } finally {
      tempDir.deleteSync(recursive: true);
    }
  });

  test('throws when terminal profile not found', () async {
    when(() => mockTerminalRegistry.get('unknown')).thenReturn(null);

    const req = ForgeRequest(
      agentId: AgentProfileId.opencode,
      skill: SkillId.editWidget,
      widget: SelectedWidget(
        node: WidgetNode(
          id: 'w-1',
          className: 'MyWidget',
          children: [],
          creationLocation: null,
        ),
        ancestorClasses: [],
        sourceSnippet: null,
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      ),
      terminalId: 'unknown',
      projectRoot: '/tmp',
    );

    expect(() => launcher.launch(req), throwsA(isA<StateError>()));
  });
}
