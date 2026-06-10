// ignore_for_file: prefer_mixin, reason: Cubit test fakes mix in Mock.

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/projects/git_status_service.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/forge/cubit/context_attachments_cubit.dart';
import 'package:pickforge/features/forge/forge.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/components/components.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

class _RecordingForgeCubit extends ForgeCubit {
  _RecordingForgeCubit()
      : super(_ThrowingLauncher(), _ThrowingAdb(), _NoopPool());

  SelectedWidget? forgedSelection;
  String? forgedProjectRoot;
  String? forgedChatId;
  String? forgedDeviceSerial;
  String? forgedDevicePlatform;
  String? forgedInitialPromptOverride;

  @override
  void selectSkill(SkillId skill) {
    emit(state.copyWith(skill: skill));
  }

  @override
  void selectAgent(AgentProfileId agentId) {
    emit(state.copyWith(agentId: agentId));
  }

  @override
  void selectTerminal(String terminalId) {
    emit(state.copyWith(terminalId: terminalId));
  }

  @override
  Future<void> forge({
    required SelectedWidget selection,
    required String projectRoot,
    required String chatId,
    List<String> attachmentPaths = const [],
    String customNote = '',
    String? deviceSerial,
    String? devicePlatform,
    String? initialPromptOverride,
  }) async {
    forgedSelection = selection;
    forgedProjectRoot = projectRoot;
    forgedChatId = chatId;
    forgedDeviceSerial = deviceSerial;
    forgedDevicePlatform = devicePlatform;
    forgedInitialPromptOverride = initialPromptOverride;
  }

  @override
  Future<ForgeContextPreview> preview({
    required SelectedWidget selection,
    required String projectRoot,
    List<String> attachmentPaths = const [],
    String customNote = '',
  }) async {
    return ForgeContextPreview(
      skillMarkdown: '# Skill',
      widgetContextMarkdown: '# Widget',
      initialPrompt: '# Prompt',
    );
  }
}

class _ThrowingLauncher extends Fake implements AgentLauncher {}

class _ThrowingAdb extends Fake implements AdbScreenshotCapturer {}

class _NoopPool extends Fake implements PtySessionPool {}

class _ProjectSettings extends Mock implements ProjectSettingsRepository {}

class _SessionCubit extends Cubit<EmulatorSessionState>
    with Mock
    implements EmulatorSessionCubit {
  _SessionCubit(super.initialState);
}

class _CleanProcessRunner implements ProcessRunner {
  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    return ProcessResult(1, 0, '', '');
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}

class _GitProcessRunner implements ProcessRunner {
  _GitProcessRunner({this.stdoutByArgs = const {}});

  final Map<String, String> stdoutByArgs;
  final commands = <String>[];
  final cwds = <String?>[];

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    commands.add('$executable ${arguments.join(' ')}');
    cwds.add(cwd);
    return ProcessResult(
      1,
      0,
      stdoutByArgs[arguments.join(' ')] ?? '',
      '',
    );
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}

class _RunAsyncProcessRunner implements ProcessRunner {
  _RunAsyncProcessRunner(this._tester);

  final WidgetTester _tester;
  Future<void> _tail = Future<void>.value();

  Future<void> waitForIdle() async {
    while (true) {
      final current = _tail;
      await current.catchError((_) {});
      if (identical(current, _tail)) return;
    }
  }

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    final previous = _tail.catchError((_) {});
    final gate = Completer<void>();
    _tail = previous.whenComplete(() => gate.future);
    await previous;
    try {
      final result = await _tester.runAsync(
        () => Process.run(
          executable,
          arguments,
          workingDirectory: cwd,
          environment: env,
        ).timeout(const Duration(seconds: 5)),
      );
      if (result == null) {
        throw ProcessRunnerException(executable, 'runAsync returned null');
      }
      return result;
    } on ProcessException catch (e) {
      throw ProcessRunnerException(executable, e);
    } finally {
      gate.complete();
    }
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await configureDependencies();
    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(_CleanProcessRunner());
    final settings = _ProjectSettings();
    when(() => settings.getValidatorCommand(any()))
        .thenAnswer((_) async => null);
    await getIt.unregister<ProjectSettingsRepository>();
    getIt.registerSingleton<ProjectSettingsRepository>(settings);
  });

  tearDown(getIt.reset);

  testWidgets('ForgePanel renders Forge it button', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
          ),
        ),
      ),
    );

    expect(find.text('Forge it'), findsOneWidget);
    expect(find.byType(Card), findsNothing);
    expect(find.byType(Chip), findsNothing);
    expect(find.byType(InputChip), findsNothing);
    expect(find.byType(ActionChip), findsNothing);
    expect(find.byType(TextButton), findsNothing);
  });

  testWidgets('ForgePanel button disabled when selection is null',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: null,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
          ),
        ),
      ),
    );

    final button = tester.widget<EmberButton>(find.byType(EmberButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('ForgePanel button disabled when chat is null', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: null,
          ),
        ),
      ),
    );

    final button = tester.widget<EmberButton>(find.byType(EmberButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('ForgePanel button disabled for framework widgets',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _frameworkWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
          ),
        ),
      ),
    );

    expect(find.text('Pick a widget from your app source.'), findsOneWidget);
    final button = tester.widget<EmberButton>(find.byType(EmberButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('ForgePanel opens active skill source dialog', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final tempDir = Directory.systemTemp.createTempSync(
      'forge_panel_skill_source_test_',
    );
    addTearDown(() => tempDir.deleteSync(recursive: true));
    final overrideDir = Directory(
      '${tempDir.path}/.pickforge/skills',
    )..createSync(recursive: true);
    final overrideFile = File('${overrideDir.path}/edit-widget.md')
      ..writeAsStringSync('# Override Skill');

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: null,
            projectRoot: tempDir.path,
            chatId: 'chat-1',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Inspect active skill source'));
    await tester.pumpAndSettle();

    expect(find.text('Active skill source'), findsOneWidget);
    expect(find.text('Project override'), findsOneWidget);
    expect(find.text(overrideFile.path), findsOneWidget);
  });

  testWidgets('ForgePanel sends prompt to active chat', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Forge it'));
    await tester.pumpAndSettle();

    expect(cubit.forgedSelection, _sampleWidget);
    expect(cubit.forgedProjectRoot, '/tmp/test');
    expect(cubit.forgedChatId, 'chat-1');
  });

  testWidgets('ForgePanel dispatches Ctrl Enter when panel has focus',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(cubit.forgedSelection, _sampleWidget);
    expect(cubit.forgedProjectRoot, '/tmp/test');
    expect(cubit.forgedChatId, 'chat-1');
  });

  testWidgets('ForgePanel labels icon-only context removal controls',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final tempDir = Directory.systemTemp.createTempSync(
      'forge_panel_context_semantics_test_',
    );
    addTearDown(() => tempDir.deleteSync(recursive: true));
    final noteFile = File('${tempDir.path}/notes.md')
      ..writeAsStringSync('note');
    final attachmentsCubit = ContextAttachmentsCubit(projectRoot: tempDir.path)
      ..setCustomNote('Remember spacing')
      ..attach(noteFile.path)
      ..attach('${tempDir.path}/.env');
    addTearDown(attachmentsCubit.close);

    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: BlocProvider<ContextAttachmentsCubit>.value(
            value: attachmentsCubit,
            child: Scaffold(
              body: ForgePanel(
                selection: _sampleWidget,
                projectRoot: tempDir.path,
                chatId: 'chat-1',
              ),
            ),
          ),
        ),
      );

      expect(find.byTooltip('Remove note'), findsOneWidget);
      expect(find.byTooltip('Remove attachment'), findsOneWidget);
      expect(find.byTooltip('Dismiss warning'), findsOneWidget);
      expect(find.bySemanticsLabel('Remove note'), findsOneWidget);
      expect(find.bySemanticsLabel('Remove attachment'), findsOneWidget);
      expect(find.bySemanticsLabel('Dismiss warning'), findsOneWidget);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('ForgePanel forwards active device serial to forge',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final forgeCubit = _RecordingForgeCubit();
    final sessionCubit = _SessionCubit(
      const EmulatorSessionState.idle(
        avd: Avd(
          id: 'R58M1234567',
          name: 'Pixel 6',
          platform: androidPhysicalPlatform,
        ),
        serial: 'R58M1234567',
      ),
    );
    addTearDown(forgeCubit.close);
    addTearDown(sessionCubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<EmulatorSessionCubit>.value(
          value: sessionCubit,
          child: Scaffold(
            body: ForgePanel(
              selection: _sampleWidget,
              projectRoot: '/tmp/test',
              chatId: 'chat-1',
              cubit: forgeCubit,
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Forge it'));
    await tester.pumpAndSettle();

    expect(forgeCubit.forgedDeviceSerial, 'R58M1234567');
    expect(forgeCubit.forgedDevicePlatform, androidPhysicalPlatform);
  });

  testWidgets('ForgePanel preview includes skill and widget context',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Preview context'));
    await tester.pumpAndSettle();

    expect(find.textContaining('# Skill'), findsOneWidget);
    expect(find.textContaining('# Widget'), findsOneWidget);
  });

  testWidgets('ForgePanel preview can forge edited final instruction',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Preview context'));
    await tester.pumpAndSettle();

    expect(find.text('Final instruction'), findsOneWidget);
    await tester.enterText(
      find.byType(TextFormField),
      'Use this edited instruction.',
    );
    await tester.tap(find.text('Forge edited instruction'));
    await tester.pumpAndSettle();

    expect(cubit.forgedInitialPromptOverride, 'Use this edited instruction.');
    expect(cubit.forgedSelection, _sampleWidget);
    expect(cubit.forgedProjectRoot, '/tmp/test');
    expect(cubit.forgedChatId, 'chat-1');
  });

  testWidgets('ForgePanel confirms before forging into dirty worktree',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(
      _GitProcessRunner(
        stdoutByArgs: {
          'status --porcelain=v1':
              'M  lib/a.dart\n M lib/b.dart\n?? notes.txt\n',
          'rev-parse --abbrev-ref HEAD': 'feature/dirty\n',
        },
      ),
    );

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Forge it'));
    await tester.pumpAndSettle();

    expect(find.text('Forge into dirty worktree?'), findsOneWidget);
    expect(find.text('Branch: feature/dirty'), findsWidgets);
    expect(
      find.textContaining('Staged: 1, unstaged: 1, untracked: 1'),
      findsOneWidget,
    );
    expect(cubit.forgedSelection, isNull);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(cubit.forgedSelection, _sampleWidget);
    expect(cubit.forgedProjectRoot, '/tmp/test');
    expect(cubit.forgedChatId, 'chat-1');
  });

  testWidgets('ForgePanel creates checkpoint before forging dirty worktree',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final runner = _GitProcessRunner(
      stdoutByArgs: {
        'status --porcelain=v1': ' M lib/b.dart\n?? scratch.txt\n',
        'rev-parse --abbrev-ref HEAD': 'feature/checkpoint\n',
        'diff --stat HEAD': ' lib/b.dart | 1 +\n',
        'commit -m chore: pickforge checkpoint':
            '[feature/checkpoint abc123] chore: pickforge checkpoint\n',
        'rev-parse --short HEAD': 'abc123\n',
      },
    );
    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(runner);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Forge it'));
    await tester.pumpAndSettle();

    expect(find.text('Create checkpoint'), findsOneWidget);

    await tester.tap(find.text('Create checkpoint'));
    await tester.pumpAndSettle();

    expect(runner.commands, contains('git add -u'));
    expect(
      runner.commands,
      contains('git commit -m chore: pickforge checkpoint'),
    );
    expect(find.text('Checkpoint commit created (abc123)'), findsOneWidget);
    expect(cubit.forgedSelection, _sampleWidget);
    expect(cubit.forgedProjectRoot, '/tmp/test');
    expect(cubit.forgedChatId, 'chat-1');
  });

  testWidgets('ForgePanel shows post-forge diff summary', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(
      _GitProcessRunner(
        stdoutByArgs: {
          'status --porcelain=v1':
              'M  lib/a.dart\n M lib/b.dart\n?? scratch.txt\n',
          'rev-parse --abbrev-ref HEAD': 'feature/review\n',
          'diff --stat HEAD': ' lib/a.dart | 2 ++\n lib/b.dart | 1 +\n',
        },
      ),
    );

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('PROJECT CHANGES'), findsOneWidget);
    expect(find.text('Copy diff'), findsOneWidget);
    expect(find.text('Branch: feature/review'), findsOneWidget);
    expect(find.text('3 changed files'), findsOneWidget);
    expect(find.textContaining('lib/a.dart'), findsWidgets);
    expect(find.textContaining('lib/b.dart'), findsWidgets);
    expect(find.textContaining('scratch.txt'), findsOneWidget);
  });

  testWidgets('ForgePanel wraps project change actions in narrow panels',
      (tester) async {
    tester.view.physicalSize = const Size(360, 760);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(
      _GitProcessRunner(
        stdoutByArgs: {
          'status --porcelain=v1':
              'M  lib/a.dart\n M lib/b.dart\n?? scratch.txt\n',
          'rev-parse --abbrev-ref HEAD': 'feature/review\n',
          'diff --stat HEAD': ' lib/a.dart | 2 ++\n lib/b.dart | 1 +\n',
        },
      ),
    );

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SizedBox(
            width: 320,
            child: ForgePanel(
              selection: _sampleWidget,
              projectRoot: '/tmp/test',
              chatId: 'chat-1',
              cubit: cubit,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('PROJECT CHANGES'), findsOneWidget);
    expect(find.text('Copy diff'), findsOneWidget);
  });

  testWidgets('ForgePanel shows latest hot reload result beside diff',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(
      _GitProcessRunner(
        stdoutByArgs: {
          'status --porcelain=v1': ' M lib/b.dart\n',
          'rev-parse --abbrev-ref HEAD': 'feature/review\n',
          'diff --stat HEAD': ' lib/b.dart | 1 +\n',
        },
      ),
    );

    final session = _SessionCubit(
      EmulatorSessionState.running(
        vmServiceUri: 'ws://x/ws',
        stats: RunStats(hotReloadCount: 1),
        lastReloadAt: DateTime(2026),
        lastReloadSucceeded: true,
        lastReloadDurationMs: 120,
      ),
    );
    addTearDown(session.close);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<EmulatorSessionCubit>.value(
          value: session,
          child: Scaffold(
            body: ForgePanel(
              selection: _sampleWidget,
              projectRoot: '/tmp/test',
              chatId: 'chat-1',
              cubit: cubit,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('PROJECT CHANGES'), findsOneWidget);
    expect(find.text('Hot reload passed (120 ms)'), findsOneWidget);
  });

  testWidgets('ForgePanel shows failed hot restart hint beside diff',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(
      _GitProcessRunner(
        stdoutByArgs: {
          'status --porcelain=v1': ' M lib/b.dart\n',
          'rev-parse --abbrev-ref HEAD': 'feature/review\n',
          'diff --stat HEAD': ' lib/b.dart | 1 +\n',
        },
      ),
    );

    final session = _SessionCubit(
      EmulatorSessionState.running(
        vmServiceUri: 'ws://x/ws',
        stats: RunStats(),
        lastReloadAt: DateTime(2026),
        lastReloadSucceeded: false,
        lastReloadFullRestart: true,
        lastReloadDurationMs: 88,
        lastReloadHint: 'Compilation failed',
      ),
    );
    addTearDown(session.close);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<EmulatorSessionCubit>.value(
          value: session,
          child: Scaffold(
            body: ForgePanel(
              selection: _sampleWidget,
              projectRoot: '/tmp/test',
              chatId: 'chat-1',
              cubit: cubit,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Hot restart failed (88 ms)'), findsOneWidget);
    expect(find.text('Compilation failed'), findsOneWidget);
  });

  testWidgets('ForgePanel opens changed files and shows discard instructions',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final runner = _GitProcessRunner(
      stdoutByArgs: {
        'status --porcelain=v1': 'M  lib/a.dart\n M lib/b.dart\n',
        'rev-parse --abbrev-ref HEAD': 'feature/review\n',
        'diff --stat HEAD': ' lib/a.dart | 2 ++\n lib/b.dart | 1 +\n',
      },
    );
    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(runner);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Open changed file').first);
    await tester.pumpAndSettle();

    final openedPath = p.normalize(p.join('/tmp/test', 'lib', 'a.dart'));
    expect(
      runner.commands.any((command) => command.contains(openedPath)),
      isTrue,
    );
    expect(find.text('Opened a.dart'), findsOneWidget);

    await tester.tap(find.text('Discard instructions'));
    await tester.pumpAndSettle();

    expect(find.text('Discard changes safely'), findsOneWidget);
    expect(
      find.textContaining('PickForge never discards changes for you'),
      findsOneWidget,
    );
    expect(find.textContaining('git restore <file>'), findsOneWidget);
    expect(find.textContaining('git clean -n'), findsOneWidget);
  });

  testWidgets('ForgePanel runs configured validator from project changes',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final runner = _GitProcessRunner(
      stdoutByArgs: {
        'status --porcelain=v1': ' M lib/b.dart\n',
        'rev-parse --abbrev-ref HEAD': 'feature/review\n',
        'diff --stat HEAD': ' lib/b.dart | 1 +\n',
        // POSIX and Windows shell invocations of the validator runner.
        '-lc fvm flutter analyze': 'No issues found!',
        '/C fvm flutter analyze': 'No issues found!',
      },
    );
    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(runner);

    final settings = _ProjectSettings();
    when(() => settings.getValidatorCommand('/tmp/test'))
        .thenAnswer((_) async => 'fvm flutter analyze');
    await getIt.unregister<ProjectSettingsRepository>();
    getIt.registerSingleton<ProjectSettingsRepository>(settings);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Run validator'), findsOneWidget);

    await tester.tap(find.text('Run validator'));
    await tester.pumpAndSettle();

    expect(
      runner.commands.any(
        (command) => command.contains('fvm flutter analyze'),
      ),
      isTrue,
    );
    expect(runner.cwds, contains('/tmp/test'));
    expect(find.text('Validator passed'), findsOneWidget);
    expect(find.textContaining('No issues found!'), findsOneWidget);
  });

  testWidgets('ForgePanel checkpoints a real dirty git repository',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 760);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final repo = Directory.systemTemp.createTempSync(
      'forge_panel_real_git_test_',
    );
    addTearDown(() => repo.deleteSync(recursive: true));
    final libDir = Directory('${repo.path}/lib')..createSync(recursive: true);
    final mainFile = File('${libDir.path}/main.dart')
      ..writeAsStringSync('void main() {}\n');
    final stagedFile = File('${libDir.path}/staged.dart')
      ..writeAsStringSync("const staged = 'before';\n");
    final unstagedFile = File('${libDir.path}/unstaged.dart')
      ..writeAsStringSync("const unstaged = 'before';\n");

    await _git(tester, repo, ['init', '-b', 'feature/panel-real-git']);
    await _git(
      tester,
      repo,
      ['config', 'user.email', 'pickforge@example.test'],
    );
    await _git(tester, repo, ['config', 'user.name', 'Pickforge Test']);
    await _git(tester, repo, ['config', 'commit.gpgSign', 'false']);
    await _git(tester, repo, [
      'config',
      'core.hooksPath',
      '.git/hooks-disabled',
    ]);
    await _git(tester, repo, ['add', '.']);
    await _git(tester, repo, ['commit', '-m', 'initial']);

    stagedFile.writeAsStringSync("const staged = 'after';\n");
    await _git(tester, repo, ['add', 'lib/staged.dart']);
    unstagedFile.writeAsStringSync("const unstaged = 'after';\n");
    final untrackedFile = File('${repo.path}/scratch.txt')
      ..writeAsStringSync('new\n');

    final runner = _RunAsyncProcessRunner(tester);
    final service = GitStatusService(runner);
    final before = await service.status(repo.path);
    expect(before.staged, 1);
    expect(before.unstaged, 1);
    expect(before.untracked, 1);
    final diffSummary = await service.diffSummary(repo.path);
    expect(
      diffSummary?.changedFiles,
      containsAll(['lib/staged.dart', 'lib/unstaged.dart', 'scratch.txt']),
    );

    await getIt.unregister<ProcessRunner>();
    getIt.registerSingleton<ProcessRunner>(runner);

    final selection = SelectedWidget(
      node: WidgetNode(
        id: 'w-real-git',
        className: 'Text',
        children: const [],
        creationLocation: CreationLocation(
          file: mainFile.path,
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
    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: selection,
            projectRoot: repo.path,
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    await runner.waitForIdle();

    await tester.tap(find.text('Forge it'));
    await runner.waitForIdle();
    await tester.pump();
    await _pumpUntilFound(
      tester,
      find.text('Forge into dirty worktree?'),
    );

    expect(find.text('Forge into dirty worktree?'), findsOneWidget);
    expect(find.text('Branch: feature/panel-real-git'), findsWidgets);
    expect(
      find.textContaining('Staged: 1, unstaged: 1, untracked: 1'),
      findsOneWidget,
    );

    await tester.tap(find.text('Create checkpoint'));
    await runner.waitForIdle();
    await tester.pump();
    await _pumpUntil(tester, () => cubit.forgedSelection != null);
    await _pumpUntilFound(
      tester,
      find.textContaining('Checkpoint commit created'),
    );

    expect(find.textContaining('Checkpoint commit created'), findsOneWidget);
    expect(cubit.forgedSelection, selection);
    expect(cubit.forgedProjectRoot, repo.path);
    expect(cubit.forgedChatId, 'chat-1');

    final after = await service.status(repo.path);
    expect(after.staged, 0);
    expect(after.unstaged, 0);
    expect(after.untracked, 1);
    expect(untrackedFile.existsSync(), isTrue);
  });
}

Future<void> _git(
  WidgetTester tester,
  Directory repo,
  List<String> args,
) async {
  final result = await tester.runAsync(
    () => Process.run(
      'git',
      args,
      workingDirectory: repo.path,
    ).timeout(const Duration(seconds: 5)),
  );
  if (result == null) {
    fail('git ${args.join(' ')} did not finish');
  }
  if (result.exitCode != 0) {
    fail('git ${args.join(' ')} failed: ${result.stderr}');
  }
}

Future<void> _pumpUntilFound(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  await _pumpUntil(
    tester,
    () => finder.evaluate().isNotEmpty,
    timeout: timeout,
  );
}

Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() predicate, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final end = tester.binding.clock.fromNowBy(timeout);
  while (tester.binding.clock.now().isBefore(end)) {
    if (predicate()) return;
    await tester.pump(const Duration(milliseconds: 50));
  }
  fail('Timed out after $timeout.');
}
