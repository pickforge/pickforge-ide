import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';

class _MockSettingsRepo extends Mock implements ProjectSettingsRepository {}

void main() {
  late ProjectSettingsRepository repo;

  setUp(() {
    repo = _MockSettingsRepo();
    registerFallbackValue(const SettingsState());
  });

  group('SettingsCubit', () {
    test('initial state is empty', () {
      final cubit = SettingsCubit(repo);
      expect(cubit.state.defaultAgent, isNull);
    });

    blocTest<SettingsCubit, SettingsState>(
      'load emits state from repo',
      setUp: () {
        when(() => repo.getDefaultAgentId('/root'))
            .thenAnswer((_) async => 'claude-code');
      },
      build: () => SettingsCubit(repo),
      act: (cubit) => cubit.load('/root'),
      expect: () => [
        const SettingsState(defaultAgent: 'claude-code'),
      ],
    );

    blocTest<SettingsCubit, SettingsState>(
      'setDefaultAgent writes to repo and emits',
      build: () => SettingsCubit(repo),
      setUp: () {
        when(() => repo.setDefaultAgentId('/root', 'codex'))
            .thenAnswer((_) async {});
      },
      act: (cubit) => cubit.setDefaultAgent('/root', 'codex'),
      expect: () => [
        const SettingsState(defaultAgent: 'codex'),
      ],
      verify: (_) {
        verify(() => repo.setDefaultAgentId('/root', 'codex')).called(1);
      },
    );
  });
}
