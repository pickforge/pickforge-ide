import 'dart:io';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/agent/models/forge_request.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

class _MockLauncher extends Mock implements AgentLauncher {}

class _MockAdb extends Mock implements AdbScreenshotCapturer {}

class _MockPool extends Mock implements PtySessionPool {}

class _MockDiagnostics extends Mock implements DiagnosticsService {}

class _NullAdb extends Fake implements AdbScreenshotCapturer {
  @override
  Future<String?> capture({
    required String outputDir,
    bool isProjectLocal = true,
    String? serial,
    String? platform,
    String outputName = AdbScreenshotCapturer.defaultOutputName,
  }) async =>
      null;
}

class _RecordingPool extends PtySessionPool {
  String? chatId;
  String? prompt;

  @override
  void paste(String chatId, String prompt) {
    this.chatId = chatId;
    this.prompt = prompt;
  }
}

class _FakeForgeRequest extends Fake implements ForgeRequest {}

class _FakeSelectedWidget extends Fake implements SelectedWidget {}

PreparedContext _stubContext() => PreparedContext(
      written: WrittenContext(
        skillPath: '/tmp/.pickforge/skill-active.md',
        widgetContextPath: '/tmp/.pickforge/widget-context.md',
        initialPromptPath: '/tmp/.pickforge/initial-prompt.md',
      ),
      initialPrompt: 'do the thing',
    );

const _sampleWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w1',
    className: 'Text',
    children: [],
    creationLocation: CreationLocation(
      file: '/tmp/test/lib/main.dart',
      line: 1,
      column: 1,
    ),
  ),
  ancestorClasses: ['MaterialApp'],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

const _frameworkWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w2',
    className: 'Text',
    children: [],
    creationLocation: CreationLocation(
      file: '/opt/flutter/packages/flutter/lib/src/widgets/text.dart',
      line: 1,
      column: 1,
    ),
  ),
  ancestorClasses: ['MaterialApp'],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    registerFallbackValue(_FakeForgeRequest());
    registerFallbackValue(_FakeSelectedWidget());
  });

  late _MockLauncher launcher;
  late _MockAdb adb;
  late _MockPool pool;
  late _MockDiagnostics diagnostics;
  late ContextStorageService storage;

  setUp(() {
    launcher = _MockLauncher();
    adb = _MockAdb();
    pool = _MockPool();
    diagnostics = _MockDiagnostics();
    storage = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': '/tmp/pf-test-home-forge'},
    );
    when(() => pool.paste(any(), any())).thenReturn(null);
    when(() => diagnostics.recordLog(any(), any())).thenReturn(null);
    when(() => diagnostics.recordAgentError(any())).thenReturn(null);
    getIt.registerSingleton<DiagnosticsService>(diagnostics);
  });

  tearDown(getIt.reset);

  ForgeCubit buildCubit() => ForgeCubit(launcher, adb, pool, storage);

  group('ForgeCubit', () {
    test('initial state matches ForgeState.initial()', () {
      final cubit = buildCubit();
      expect(cubit.state, equals(ForgeState.initial()));
    });

    blocTest<ForgeCubit, ForgeState>(
      'selectSkill emits new skill',
      build: buildCubit,
      act: (cubit) => cubit.selectSkill(SkillId.extractWidget),
      expect: () => [
        ForgeState.initial().copyWith(skill: SkillId.extractWidget),
      ],
    );

    blocTest<ForgeCubit, ForgeState>(
      'selectAgent emits new agentId',
      build: buildCubit,
      act: (cubit) => cubit.selectAgent(AgentProfileId.codex),
      expect: () => [
        ForgeState.initial().copyWith(agentId: AgentProfileId.codex),
      ],
    );

    blocTest<ForgeCubit, ForgeState>(
      'selectTerminal emits new terminalId',
      build: buildCubit,
      act: (cubit) => cubit.selectTerminal('kitty'),
      expect: () => [
        ForgeState.initial().copyWith(terminalId: 'kitty'),
      ],
    );

    blocTest<ForgeCubit, ForgeState>(
      'forge succeeds: launching true → false; sends prompt to pool',
      build: () {
        when(
          () => adb.capture(
            outputDir: any(named: 'outputDir'),
            isProjectLocal: any(named: 'isProjectLocal'),
            serial: any(named: 'serial'),
            platform: any(named: 'platform'),
          ),
        ).thenAnswer((_) async => null);
        when(() => launcher.prepareContext(any()))
            .thenAnswer((_) async => _stubContext());
        return buildCubit();
      },
      act: (cubit) => cubit.forge(
        selection: _sampleWidget,
        projectRoot: '/tmp/test',
        chatId: 'chat-1',
      ),
      expect: () => [
        ForgeState.initial().copyWith(launching: true, lastError: null),
        ForgeState.initial().copyWith(launching: false),
      ],
      verify: (_) {
        verify(() => launcher.prepareContext(any())).called(1);
        verify(() => pool.paste('chat-1', 'do the thing')).called(1);
      },
    );

    blocTest<ForgeCubit, ForgeState>(
      'forge captures adb screenshot and passes enriched widget',
      build: () {
        when(
          () => adb.capture(
            outputDir: any(named: 'outputDir'),
            isProjectLocal: any(named: 'isProjectLocal'),
            serial: any(named: 'serial'),
            platform: any(named: 'platform'),
          ),
        ).thenAnswer((_) async => '/tmp/test/.pickforge/device-screen.png');
        when(() => launcher.prepareContext(any()))
            .thenAnswer((_) async => _stubContext());
        return buildCubit();
      },
      act: (cubit) => cubit.forge(
        selection: _sampleWidget,
        projectRoot: '/tmp/test',
        chatId: 'chat-1',
      ),
      verify: (_) {
        verify(
          () => launcher.prepareContext(
            any(
              that: isA<ForgeRequest>().having(
                (r) => r.widget.adbScreenshotPath,
                'adbScreenshotPath',
                '/tmp/test/.pickforge/device-screen.png',
              ),
            ),
          ),
        ).called(1);
      },
    );

    test('forge writes real context files and sends prompt to pool', () async {
      final project = await Directory.systemTemp.createTemp('pickforge_forge_');
      addTearDown(() => project.delete(recursive: true));
      await Directory(p.join(project.path, 'lib')).create(recursive: true);
      await File(p.join(project.path, 'lib', 'main.dart')).writeAsString(
        'class CounterPage {}\n',
      );
      await Directory(p.join(project.path, '.pickforge', 'skills'))
          .create(recursive: true);
      await File(p.join(project.path, '.pickforge', '.gitignore'))
          .writeAsString('*\n');
      await File(p.join(project.path, '.pickforge', 'skills', 'edit-widget.md'))
          .writeAsString('# Edit widget skill');

      final pool = _RecordingPool();
      final storage = ContextStorageService();
      final cubit = ForgeCubit(
        AgentLauncher(
          agentRegistry: AgentProfileRegistry(const [ClaudeCodeProfile()]),
          contextWriter: PickforgeContextWriter(storage),
          skillStore: SkillStore(storage),
          widgetRenderer: const WidgetContextRenderer(),
          storage: storage,
        ),
        _NullAdb(),
        pool,
        storage,
      );
      addTearDown(cubit.close);

      const selection = SelectedWidget(
        node: WidgetNode(
          id: 'counter-page',
          className: 'CounterPage',
          children: [],
          creationLocation: CreationLocation(
            file: 'lib/main.dart',
            line: 1,
            column: 7,
          ),
        ),
        ancestorClasses: ['MaterialApp', 'Scaffold'],
        sourceSnippet: 'class CounterPage {}',
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      );

      await cubit.forge(
        selection: selection,
        projectRoot: project.path,
        chatId: 'chat-1',
      );

      final pickforgeDir = Directory(p.join(project.path, '.pickforge'));
      final skill = File(p.join(pickforgeDir.path, 'skill-active.md'));
      final widgetContext =
          File(p.join(pickforgeDir.path, 'widget-context.md'));
      final initialPrompt =
          File(p.join(pickforgeDir.path, 'initial-prompt.md'));

      expect(skill.readAsStringSync(), '# Edit widget skill');
      expect(widgetContext.readAsStringSync(), contains('CounterPage'));
      expect(initialPrompt.readAsStringSync(), contains('widget-context.md'));
      expect(pool.chatId, 'chat-1');
      expect(pool.prompt, initialPrompt.readAsStringSync());
    });

    test('forge forwards selected device serial to adb screenshot', () async {
      final project = await Directory.systemTemp.createTemp('pf_forge_serial_');
      addTearDown(() => project.delete(recursive: true));
      Directory(p.join(project.path, '.pickforge')).createSync(recursive: true);
      File(p.join(project.path, '.pickforge', '.gitignore'))
          .writeAsStringSync('*\n');
      final widget = SelectedWidget(
        node: WidgetNode(
          id: 'w1',
          className: 'Text',
          children: const [],
          creationLocation: CreationLocation(
            file: p.join(project.path, 'lib', 'main.dart'),
            line: 1,
            column: 1,
          ),
        ),
        ancestorClasses: const ['MaterialApp'],
        sourceSnippet: null,
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: const {},
      );
      when(
        () => adb.capture(
          outputDir: any(named: 'outputDir'),
          isProjectLocal: any(named: 'isProjectLocal'),
          serial: any(named: 'serial'),
          platform: any(named: 'platform'),
        ),
      ).thenAnswer((_) async => null);
      when(() => launcher.prepareContext(any()))
          .thenAnswer((_) async => _stubContext());
      final cubit = ForgeCubit(launcher, adb, pool, ContextStorageService());
      addTearDown(cubit.close);

      await cubit.forge(
        selection: widget,
        projectRoot: project.path,
        chatId: 'chat-1',
        deviceSerial: 'R58M1234567',
        devicePlatform: 'android-physical',
      );

      verify(
        () => adb.capture(
          outputDir: p.join(project.path, '.pickforge'),
          isProjectLocal: any(named: 'isProjectLocal'),
          serial: 'R58M1234567',
          platform: 'android-physical',
        ),
      ).called(1);
    });

    blocTest<ForgeCubit, ForgeState>(
      'forge failure emits error state and skips paste',
      build: () {
        when(
          () => adb.capture(
            outputDir: any(named: 'outputDir'),
            isProjectLocal: any(named: 'isProjectLocal'),
            serial: any(named: 'serial'),
            platform: any(named: 'platform'),
          ),
        ).thenAnswer((_) async => null);
        when(
          () => launcher.prepareContext(any()),
        ).thenThrow(Exception('launch failed'));
        return buildCubit();
      },
      act: (cubit) => cubit.forge(
        selection: _sampleWidget,
        projectRoot: '/tmp/test',
        chatId: 'chat-x',
      ),
      verify: (cubit) {
        expect(cubit.state.launching, isFalse);
        expect(cubit.state.lastError, isNotNull);
        verify(() => diagnostics.recordAgentError(any())).called(1);
        verifyNever(() => pool.paste(any(), any()));
      },
    );

    blocTest<ForgeCubit, ForgeState>(
      'forge skips non-user-code widgets',
      build: buildCubit,
      act: (cubit) => cubit.forge(
        selection: _frameworkWidget,
        projectRoot: '/tmp/test',
        chatId: 'chat-1',
      ),
      expect: () => [
        isA<ForgeState>()
            .having((s) => s.launching, 'launching', isFalse)
            .having((s) => s.lastError, 'lastError', isNotNull),
      ],
      verify: (_) {
        verifyNever(
          () => adb.capture(
            outputDir: any(named: 'outputDir'),
            isProjectLocal: any(named: 'isProjectLocal'),
            serial: any(named: 'serial'),
            platform: any(named: 'platform'),
          ),
        );
        verifyNever(() => launcher.prepareContext(any()));
        verifyNever(() => pool.paste(any(), any()));
      },
    );
  });
}
