import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';

class _MockSettingsRepo extends Mock implements ProjectSettingsRepository {}

class _MockTerminalRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

void main() {
  late ProjectSettingsRepository repo;
  late EmbeddedTerminalSettingsRepository terminalRepo;

  setUp(() {
    repo = _MockSettingsRepo();
    terminalRepo = _MockTerminalRepo();
    registerFallbackValue(EmbeddedTerminalSettings.defaults);
  });

  group('SettingsCubit', () {
    test('initial state is empty', () {
      final cubit = SettingsCubit(repo, terminalRepo);
      expect(cubit.state.defaultAgent, isNull);
      expect(cubit.state.terminal, EmbeddedTerminalSettings.defaults);
    });

    blocTest<SettingsCubit, SettingsState>(
      'load emits state from repos',
      setUp: () {
        when(() => repo.getDefaultAgentId('/root'))
            .thenAnswer((_) async => 'claude-code');
        when(() => terminalRepo.load()).thenAnswer(
          (_) async => const EmbeddedTerminalSettings(
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            themeId: TerminalThemeId.solarizedDark,
          ),
        );
      },
      build: () => SettingsCubit(repo, terminalRepo),
      act: (cubit) => cubit.load('/root'),
      expect: () => [
        isA<SettingsState>()
            .having((s) => s.defaultAgent, 'agent', 'claude-code')
            .having(
              (s) => s.terminal.fontFamily,
              'fontFamily',
              'JetBrains Mono',
            ),
      ],
    );

    test('ignores stale load completions', () async {
      final first = Completer<String?>();
      final second = Completer<String?>();
      when(() => repo.getDefaultAgentId('/first'))
          .thenAnswer((_) => first.future);
      when(() => repo.getDefaultAgentId('/second'))
          .thenAnswer((_) => second.future);
      when(() => terminalRepo.load())
          .thenAnswer((_) async => EmbeddedTerminalSettings.defaults);

      final cubit = SettingsCubit(repo, terminalRepo);
      final firstLoad = cubit.load('/first');
      final secondLoad = cubit.load('/second');

      second.complete('codex');
      await secondLoad;
      expect(cubit.state.defaultAgent, 'codex');

      first.complete('claude-code');
      await firstLoad;
      expect(cubit.state.defaultAgent, 'codex');
    });

    test('load completion after close is ignored', () async {
      final agent = Completer<String?>();
      when(() => repo.getDefaultAgentId('/root'))
          .thenAnswer((_) => agent.future);
      when(() => terminalRepo.load())
          .thenAnswer((_) async => EmbeddedTerminalSettings.defaults);

      final cubit = SettingsCubit(repo, terminalRepo);
      final load = cubit.load('/root');
      await cubit.close();

      agent.complete('codex');
      await load;
    });

    blocTest<SettingsCubit, SettingsState>(
      'setDefaultAgent writes to repo and emits',
      build: () => SettingsCubit(repo, terminalRepo),
      setUp: () {
        when(() => repo.setDefaultAgentId('/root', 'codex'))
            .thenAnswer((_) async {});
      },
      act: (cubit) => cubit.setDefaultAgent('/root', 'codex'),
      expect: () => [
        isA<SettingsState>().having((s) => s.defaultAgent, 'agent', 'codex'),
      ],
    );

    blocTest<SettingsCubit, SettingsState>(
      'setTerminal writes to repo and emits',
      build: () => SettingsCubit(repo, terminalRepo),
      setUp: () {
        when(() => terminalRepo.save(any())).thenAnswer((_) async {});
      },
      act: (cubit) => cubit.setTerminal(
        const EmbeddedTerminalSettings(
          fontFamily: 'Berkeley Mono',
          fontSize: 16,
          themeId: TerminalThemeId.draculaDark,
        ),
      ),
      expect: () => [
        isA<SettingsState>().having(
          (s) => s.terminal.fontSize,
          'fontSize',
          16,
        ),
      ],
    );
  });
}
