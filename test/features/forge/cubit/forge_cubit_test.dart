import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/agent/models/forge_request.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

class _MockLauncher extends Mock implements AgentLauncher {}

class _MockAdb extends Mock implements AdbScreenshotCapturer {}

class _MockPool extends Mock implements PtySessionPool {}

class _MockDiagnostics extends Mock implements DiagnosticsService {}

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
  setUpAll(() {
    registerFallbackValue(_FakeForgeRequest());
    registerFallbackValue(_FakeSelectedWidget());
  });

  late _MockLauncher launcher;
  late _MockAdb adb;
  late _MockPool pool;
  late _MockDiagnostics diagnostics;

  setUp(() {
    launcher = _MockLauncher();
    adb = _MockAdb();
    pool = _MockPool();
    diagnostics = _MockDiagnostics();
    when(() => pool.sendPrompt(any(), any())).thenReturn(null);
    when(() => diagnostics.recordLog(any(), any())).thenReturn(null);
    getIt.registerSingleton<DiagnosticsService>(diagnostics);
  });

  tearDown(getIt.reset);

  ForgeCubit buildCubit() => ForgeCubit(launcher, adb, pool);

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
          () => adb.capture(outputDir: any(named: 'outputDir')),
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
        verify(() => pool.sendPrompt('chat-1', 'do the thing')).called(1);
      },
    );

    blocTest<ForgeCubit, ForgeState>(
      'forge captures adb screenshot and passes enriched widget',
      build: () {
        when(
          () => adb.capture(outputDir: any(named: 'outputDir')),
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

    blocTest<ForgeCubit, ForgeState>(
      'forge failure emits error state and skips sendPrompt',
      build: () {
        when(
          () => adb.capture(outputDir: any(named: 'outputDir')),
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
        verify(() => diagnostics.recordLog('error', any())).called(1);
        verifyNever(() => pool.sendPrompt(any(), any()));
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
        verifyNever(() => adb.capture(outputDir: any(named: 'outputDir')));
        verifyNever(() => launcher.prepareContext(any()));
        verifyNever(() => pool.sendPrompt(any(), any()));
      },
    );
  });
}
