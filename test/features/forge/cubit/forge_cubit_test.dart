import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/agent/models/forge_request.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

class _MockLauncher extends Mock implements AgentLauncher {}

class _MockAdb extends Mock implements AdbScreenshotCapturer {}

class _FakeForgeRequest extends Fake implements ForgeRequest {}

class _FakeSelectedWidget extends Fake implements SelectedWidget {}

const _sampleWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w1',
    className: 'Text',
    children: [],
    creationLocation: null,
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

  setUp(() {
    launcher = _MockLauncher();
    adb = _MockAdb();
  });

  group('ForgeCubit', () {
    test('initial state matches ForgeState.initial()', () {
      final cubit = ForgeCubit(launcher, adb);
      expect(cubit.state, equals(ForgeState.initial()));
    });

    blocTest<ForgeCubit, ForgeState>(
      'selectSkill emits new skill',
      build: () => ForgeCubit(launcher, adb),
      act: (cubit) => cubit.selectSkill(SkillId.extractWidget),
      expect: () => [
        ForgeState.initial().copyWith(skill: SkillId.extractWidget),
      ],
    );

    blocTest<ForgeCubit, ForgeState>(
      'selectAgent emits new agentId',
      build: () => ForgeCubit(launcher, adb),
      act: (cubit) => cubit.selectAgent(AgentProfileId.codex),
      expect: () => [
        ForgeState.initial().copyWith(agentId: AgentProfileId.codex),
      ],
    );

    blocTest<ForgeCubit, ForgeState>(
      'selectTerminal emits new terminalId',
      build: () => ForgeCubit(launcher, adb),
      act: (cubit) => cubit.selectTerminal('kitty'),
      expect: () => [
        ForgeState.initial().copyWith(terminalId: 'kitty'),
      ],
    );

    blocTest<ForgeCubit, ForgeState>(
      'forge succeeds: launching true → false',
      build: () {
        when(
          () => adb.capture(outputDir: any(named: 'outputDir')),
        ).thenAnswer((_) async => null);
        when(() => launcher.launch(any())).thenAnswer((_) async {});
        return ForgeCubit(launcher, adb);
      },
      act: (cubit) => cubit.forge(
        selection: _sampleWidget,
        projectRoot: '/tmp/test',
      ),
      expect: () => [
        ForgeState.initial().copyWith(launching: true, lastError: null),
        ForgeState.initial().copyWith(launching: false),
      ],
      verify: (_) {
        verify(() => launcher.launch(any())).called(1);
      },
    );

    blocTest<ForgeCubit, ForgeState>(
      'forge captures adb screenshot and passes enriched widget',
      build: () {
        when(
          () => adb.capture(outputDir: any(named: 'outputDir')),
        ).thenAnswer((_) async => '/tmp/test/.pickforge/device-screen.png');
        when(() => launcher.launch(any())).thenAnswer((_) async {});
        return ForgeCubit(launcher, adb);
      },
      act: (cubit) => cubit.forge(
        selection: _sampleWidget,
        projectRoot: '/tmp/test',
      ),
      verify: (_) {
        verify(
          () => launcher.launch(
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
      'forge failure emits error state',
      build: () {
        when(
          () => adb.capture(outputDir: any(named: 'outputDir')),
        ).thenAnswer((_) async => null);
        when(
          () => launcher.launch(any()),
        ).thenThrow(Exception('launch failed'));
        return ForgeCubit(launcher, adb);
      },
      act: (cubit) => cubit.forge(
        selection: _sampleWidget,
        projectRoot: '/tmp/test',
      ),
      verify: (cubit) {
        expect(cubit.state.launching, isFalse);
        expect(cubit.state.lastError, isNotNull);
      },
    );
  });
}
