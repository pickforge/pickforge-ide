import 'dart:async';
import 'dart:io';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_migrator.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';

class _MockSettingsRepo extends Mock implements ProjectSettingsRepository {}

class _MockTerminalRepo extends Mock
    implements EmbeddedTerminalSettingsRepository {}

void main() {
  late ProjectSettingsRepository repo;
  late EmbeddedTerminalSettingsRepository terminalRepo;
  late Directory tmpHome;
  late ContextStorageService storage;
  const migrator = ContextStorageMigrator();

  SettingsCubit build() => SettingsCubit(repo, terminalRepo, storage, migrator);

  setUp(() async {
    repo = _MockSettingsRepo();
    terminalRepo = _MockTerminalRepo();
    tmpHome = await Directory.systemTemp.createTemp('pf_home');
    storage = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': tmpHome.path},
      isWindows: false,
      settings: repo,
    );
    registerFallbackValue(EmbeddedTerminalSettings.defaults);
    registerFallbackValue(const ContextStorageLocation.pickforgeHome());
    // Default stubs so resolve() during load never throws.
    when(() => repo.getDefaultAgentId(any())).thenAnswer((_) async => null);
    when(() => repo.getValidatorCommand(any())).thenAnswer((_) async => null);
    when(() => repo.getContextStorageLocation(any()))
        .thenAnswer((_) async => null);
    when(() => terminalRepo.load())
        .thenAnswer((_) async => EmbeddedTerminalSettings.defaults);
  });

  tearDown(() async {
    await tmpHome.delete(recursive: true);
  });

  group('SettingsCubit', () {
    test('initial state is empty', () {
      final cubit = build();
      expect(cubit.state.defaultAgent, isNull);
      expect(cubit.state.terminal, EmbeddedTerminalSettings.defaults);
      expect(cubit.state.contextStorageMode, isNull);
    });

    blocTest<SettingsCubit, SettingsState>(
      'load emits state from repos and surfaces the resolved storage mode',
      setUp: () {
        when(() => repo.getDefaultAgentId('/root'))
            .thenAnswer((_) async => 'claude-code');
        when(() => repo.getValidatorCommand('/root'))
            .thenAnswer((_) async => 'fvm flutter analyze');
        when(() => terminalRepo.load()).thenAnswer(
          (_) async => const EmbeddedTerminalSettings(
            fontFamily: 'JetBrains Mono',
            fontSize: 14,
            themeId: TerminalThemeId.solarizedDark,
          ),
        );
      },
      build: build,
      act: (cubit) => cubit.load('/root'),
      expect: () => [
        isA<SettingsState>()
            .having((s) => s.defaultAgent, 'agent', 'claude-code')
            .having(
              (s) => s.validatorCommand,
              'validator',
              'fvm flutter analyze',
            )
            .having(
              (s) => s.terminal.fontFamily,
              'fontFamily',
              'JetBrains Mono',
            )
            .having(
              (s) => s.contextStorageMode,
              'mode',
              ContextStorageMode.pickforgeHome,
            )
            .having(
              (s) => s.resolvedContextDir,
              'resolvedContextDir',
              isNotNull,
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

      final cubit = build();
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

      final cubit = build();
      final load = cubit.load('/root');
      await cubit.close();

      agent.complete('codex');
      await load;
    });

    blocTest<SettingsCubit, SettingsState>(
      'setDefaultAgent writes to repo and emits',
      build: build,
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
      'setValidatorCommand trims, writes to repo, and emits',
      build: build,
      setUp: () {
        when(
          () => repo.setValidatorCommand('/root', 'fvm flutter test'),
        ).thenAnswer((_) async {});
      },
      act: (cubit) => cubit.setValidatorCommand(
        '/root',
        '  fvm flutter test  ',
      ),
      expect: () => [
        isA<SettingsState>().having(
          (s) => s.validatorCommand,
          'validator',
          'fvm flutter test',
        ),
      ],
    );

    blocTest<SettingsCubit, SettingsState>(
      'setTerminal writes to repo and emits',
      build: build,
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

  group('SettingsCubit context storage', () {
    late Directory project;

    setUp(() async {
      project = await Directory.systemTemp.createTemp('pf_project');
      when(() => repo.setContextStorageLocation(any(), any()))
          .thenAnswer((_) async {});
    });

    tearDown(() async {
      await project.delete(recursive: true);
    });

    void writeMarker(String root) {
      final dir = Directory(p.join(root, '.pickforge'))
        ..createSync(recursive: true);
      File(p.join(dir.path, '.gitignore')).writeAsStringSync('*\n');
    }

    test('switching to a valid location persists the override', () async {
      final cubit = build();
      await cubit.load(project.path);

      await cubit.setContextStorageLocation(
        project.path,
        const ContextStorageLocation.pickforgeHome(),
      );

      verify(
        () => repo.setContextStorageLocation(
          project.path,
          const ContextStorageLocation.pickforgeHome(),
        ),
      ).called(1);
      expect(
        cubit.state.contextStorageMode,
        ContextStorageMode.pickforgeHome,
      );
      expect(cubit.state.contextStorageError, isNull);
    });

    test(
      'project-local on a non-marker .pickforge surfaces an error and '
      'does not persist',
      () async {
        // A .pickforge/ that exists WITHOUT the Pickforge marker → ensure throws.
        Directory(p.join(project.path, '.pickforge')).createSync();

        final cubit = build();
        await cubit.load(project.path);
        final before = cubit.state.contextStorageMode;

        await cubit.setContextStorageLocation(
          project.path,
          const ContextStorageLocation.projectLocal(),
        );

        expect(cubit.state.contextStorageError, isNotNull);
        // State (mode) unchanged on failure.
        expect(cubit.state.contextStorageMode, before);
        verifyNever(
          () => repo.setContextStorageLocation(any(), any()),
        );
      },
    );

    test(
      'offers a copy when the old location still has data',
      () async {
        // Start project-local with a chat present so the old location is
        // non-empty, then switch to home.
        writeMarker(project.path);
        Directory(p.join(project.path, '.pickforge', 'chats', 'chat-1'))
            .createSync(recursive: true);
        when(() => repo.getContextStorageLocation(project.path)).thenAnswer(
          (_) async => const ContextStorageLocation.projectLocal(),
        );

        final cubit = build();
        await cubit.load(project.path);

        await cubit.setContextStorageLocation(
          project.path,
          const ContextStorageLocation.pickforgeHome(),
        );

        expect(cubit.state.copyOffer, isNotNull);
        expect(cubit.state.copyOffer!.plan.chatCount, 1);
        expect(
          cubit.state.contextStorageMode,
          ContextStorageMode.pickforgeHome,
        );
      },
    );

    test('confirmCopy copies and clears the offer', () async {
      writeMarker(project.path);
      Directory(p.join(project.path, '.pickforge', 'chats', 'chat-1'))
          .createSync(recursive: true);
      File(
        p.join(project.path, '.pickforge', 'chats', 'chat-1', 'meta.json'),
      ).writeAsStringSync('{}');
      when(() => repo.getContextStorageLocation(project.path)).thenAnswer(
        (_) async => const ContextStorageLocation.projectLocal(),
      );

      final cubit = build();
      await cubit.load(project.path);
      final from = cubit.state.resolvedContextDir;

      await cubit.setContextStorageLocation(
        project.path,
        const ContextStorageLocation.pickforgeHome(),
      );
      final to = cubit.state.resolvedContextDir;
      expect(cubit.state.copyOffer, isNotNull);

      await cubit.confirmCopy();

      expect(cubit.state.copyOffer, isNull);
      // Destination chat copied; original retained.
      final destChat = Directory(
        p.join(p.dirname(to!), 'chats', 'chat-1'),
      );
      expect(destChat.existsSync(), isTrue);
      expect(
        Directory(p.join(from!, 'chats', 'chat-1')).existsSync(),
        isTrue,
      );
    });
  });
}
