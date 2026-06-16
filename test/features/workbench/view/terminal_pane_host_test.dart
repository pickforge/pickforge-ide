import 'dart:async';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/process/user_shell_environment.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_cubit.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_state.dart';
import 'package:pickforge/features/workbench/view/terminal_pane_host.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xterm/xterm.dart';

class _FakePtyProcess implements PtyProcess {
  final _output = StreamController<List<int>>.broadcast();
  final _exit = Completer<int>();

  @override
  Stream<List<int>> get output => _output.stream;

  @override
  Future<int> get exitCode => _exit.future;

  @override
  void write(List<int> bytes) {}

  @override
  void resize({required int rows, required int cols}) {}

  @override
  void kill([PtySignal signal = PtySignal.sigterm]) {
    if (!_exit.isCompleted) _exit.complete(0);
  }
}

class _FakeFactory implements PtyProcessFactory {
  Map<String, String>? lastEnvironment;

  @override
  Future<PtyProcess> start({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    Map<String, String>? environment,
    int rows = 24,
    int cols = 80,
  }) async {
    lastEnvironment = environment;
    return _FakePtyProcess();
  }
}

void main() {
  late Directory projectRoot;
  late TerminalPanesCubit cubit;
  late _FakeFactory factory;

  setUp(() async {
    projectRoot = await Directory.systemTemp.createTemp('pickforge-panes-');
    // Project-local marker keeps transcript IO under <root>/.pickforge as
    // before; the temp PICKFORGE_HOME guards the real home from any fallback.
    Directory('${projectRoot.path}/.pickforge').createSync(recursive: true);
    File('${projectRoot.path}/.pickforge/.gitignore').writeAsStringSync('*\n');
    final storageHome =
        await Directory.systemTemp.createTemp('pickforge-panes-home-');
    addTearDown(() => storageHome.delete(recursive: true));
    await getIt.reset();
    factory = _FakeFactory();
    getIt
      ..registerSingleton<PtySessionPool>(PtySessionPool())
      ..registerSingleton<PtyProcessFactory>(factory)
      ..registerSingleton<ContextStorageService>(
        ContextStorageService.forTesting(
          environment: {'PICKFORGE_HOME': storageHome.path},
        ),
      )
      // A real UserShellEnvironment would spawn `$SHELL -ilc env`, whose 3s
      // timeout Timer outlives the fake-async test body. The inherited-env-only
      // path returns synchronously without spawning anything.
      ..registerSingleton<UserShellEnvironment>(
        UserShellEnvironment(
          environment: const {'PATH': '/usr/bin'},
          isWindows: true,
        ),
      );
    cubit = TerminalPanesCubit(chatId: 'chat-1');
  });

  tearDown(() async {
    await getIt<PtySessionPool>().parkAll();
    await getIt.reset();
    await cubit.close();
    await projectRoot.delete(recursive: true);
  });

  /// The transcript replay in `_init` does real file IO, which needs real
  /// event-loop turns interleaved with microtask flushes: each runAsync
  /// window lets one IO step complete, each pump runs its continuation.
  Future<void> settleRealIo(WidgetTester tester) async {
    for (var i = 0; i < 20; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 10)),
      );
      await tester.pump();
    }
  }

  Future<void> pumpPanes(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: BlocProvider.value(
            value: cubit,
            child: BlocBuilder<TerminalPanesCubit, TerminalPanesState>(
              builder: (context, state) => Row(
                children: [
                  for (final leaf in state.leaves)
                    Expanded(
                      child: TerminalPane(
                        key: ValueKey('pane-${leaf.id}'),
                        chatId: 'chat-1',
                        projectRoot: projectRoot.path,
                        pane: leaf,
                        isFocused: state.focusedPaneId == leaf.id,
                        isFullscreen: false,
                        canClose: state.leaves.length > 1,
                        onRunningChanged: (_, {required running}) {},
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('pane headers show their callsigns', (tester) async {
    cubit.split('main', PaneSplitDirection.right);
    await pumpPanes(tester);

    expect(find.text(paneCallsigns.first.toUpperCase()), findsOneWidget);
    expect(find.text(paneCallsigns[1].toUpperCase()), findsOneWidget);
  });

  testWidgets('dragging a pane header onto another pane moves the pane',
      (tester) async {
    cubit.split('main', PaneSplitDirection.right);
    final added = cubit.state.leaves.last.id;
    await pumpPanes(tester);

    final addedHeader = find.text(paneCallsigns[1].toUpperCase());
    final mainPane = find.byKey(const ValueKey('pane-main'));
    final gesture = await tester.startGesture(
      tester.getCenter(addedHeader),
      kind: PointerDeviceKind.mouse,
    );
    await tester.pump(const Duration(milliseconds: 50));
    // Drop on the upper half of the main pane → docks above it.
    final target = tester.getTopLeft(mainPane) +
        Offset(tester.getSize(mainPane).width / 2, 40);
    await gesture.moveTo(target);
    await tester.pump(const Duration(milliseconds: 50));
    await gesture.up();
    // pumpAndSettle would never settle: the focused pane's EmberSweepBorder
    // animates continuously.
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));

    final root = cubit.state.root as PaneSplit;
    expect(root.axis, Axis.vertical);
    expect(root.children.first.id, added);
    expect(root.children.last.id, 'main');
  });

  testWidgets('a single tap focuses the tapped pane', (tester) async {
    cubit.split('main', PaneSplitDirection.right);
    final added = cubit.state.leaves.last.id;
    await pumpPanes(tester);

    // Focus the first pane, then tap the second: ONE tap must move both the
    // cubit's focus and the keyboard focus (no tap-twice).
    await tester.tap(find.byType(TerminalView).first);
    await tester.pump();
    expect(cubit.state.focusedPaneId, 'main');

    await tester.tap(find.byType(TerminalView).last);
    await tester.pump();

    expect(cubit.state.focusedPaneId, added);
    final view = tester.widget<TerminalView>(find.byType(TerminalView).last);
    expect(view.focusNode?.hasFocus, isTrue);

    // Let xterm's double-tap window expire so no timer outlives the test.
    await tester.pump(const Duration(milliseconds: 400));
  });

  testWidgets('the close button removes the pane', (tester) async {
    cubit.split('main', PaneSplitDirection.right);
    await pumpPanes(tester);

    await tester.tap(find.byTooltip('Close terminal').last);
    // pumpAndSettle would never settle: the focused pane's EmberSweepBorder
    // animates continuously.
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));

    expect(cubit.state.leaves.map((l) => l.id), ['main']);
  });

  testWidgets('Ctrl +/−/0 zooms the terminal font and persists it',
      (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    getIt.registerSingleton<EmbeddedTerminalSettingsRepository>(
      EmbeddedTerminalSettingsRepository(prefs),
    );
    await pumpPanes(tester);
    await tester.tap(find.byType(TerminalView));
    await tester.pump();

    final defaultSize = EmbeddedTerminalSettings.defaults.fontSize;
    double fontSize() => tester
        .widget<TerminalView>(find.byType(TerminalView))
        .textStyle //
        .fontSize;

    Future<void> press(LogicalKeyboardKey key) async {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(key);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pump();
    }

    await press(LogicalKeyboardKey.equal);
    expect(fontSize(), defaultSize + 1);
    expect(prefs.getDouble('terminal.fontSize'), defaultSize + 1);

    await press(LogicalKeyboardKey.minus);
    await press(LogicalKeyboardKey.minus);
    expect(fontSize(), defaultSize - 1);

    await press(LogicalKeyboardKey.digit0);
    expect(fontSize(), defaultSize);
    expect(prefs.getDouble('terminal.fontSize'), defaultSize);

    // Let xterm's double-tap window expire so no timer outlives the test.
    await tester.pump(const Duration(milliseconds: 400));
  });

  testWidgets('remounting onto a live session keeps the TUI alt screen',
      (tester) async {
    // The transcript ends inside the alt screen: a TUI is mid-flight.
    // Seed .pickforge/ with its marker synchronously (real awaited IO would
    // deadlock the fake-async test body).
    File(p.join(projectRoot.path, '.pickforge', '.gitignore'))
      ..createSync(recursive: true)
      ..writeAsStringSync('*\n');
    final chatDir = Directory(
      p.join(projectRoot.path, '.pickforge', 'chats', 'chat-1'),
    )..createSync(recursive: true);
    File(p.join(chatDir.path, 'transcript.log'))
        .writeAsStringSync('\x1b[?1049hTUI CONTENT');
    // And the session that drew it is still alive in the pool.
    final session = PtySession(
      chatId: 'chat-1',
      executable: 'sh',
      arguments: const [],
      workingDirectory: projectRoot.path,
      factory: _FakeFactory(),
    );
    await session.start();
    getIt<PtySessionPool>().attach(session);

    await pumpPanes(tester);
    await settleRealIo(tester);

    final terminal =
        tester.widget<TerminalView>(find.byType(TerminalView)).terminal;
    expect(identical(terminal.buffer, terminal.altBuffer), isTrue);
  });

  testWidgets('a fresh spawn resets stale replayed modes (no live session)',
      (tester) async {
    // Seed .pickforge/ with its marker synchronously (real awaited IO would
    // deadlock the fake-async test body).
    File(p.join(projectRoot.path, '.pickforge', '.gitignore'))
      ..createSync(recursive: true)
      ..writeAsStringSync('*\n');
    final chatDir = Directory(
      p.join(projectRoot.path, '.pickforge', 'chats', 'chat-1'),
    )..createSync(recursive: true);
    File(p.join(chatDir.path, 'transcript.log'))
        .writeAsStringSync('\x1b[?1049hSTALE TUI');

    await pumpPanes(tester);
    await settleRealIo(tester);

    final terminal =
        tester.widget<TerminalView>(find.byType(TerminalView)).terminal;
    expect(identical(terminal.buffer, terminal.mainBuffer), isTrue);

    // The spawned session owns a real transcript recorder; drive its close
    // (real IO + fake-zone event delivery) to completion here so tearDown's
    // parkAll has nothing left to await.
    final parked = getIt<PtySessionPool>().parkAll();
    await settleRealIo(tester);
    await tester.runAsync(() => parked);
  });

  testWidgets('spawned PTY inherits PICKFORGE_* discovery env vars',
      (tester) async {
    await pumpPanes(tester);
    await settleRealIo(tester);

    final env = factory.lastEnvironment;
    expect(env, isNotNull);
    expect(env!['PICKFORGE_PROJECT_ROOT'], projectRoot.path);
    expect(
      env['PICKFORGE_CONTEXT_DIR'],
      p.join(projectRoot.path, '.pickforge'),
    );
    expect(env['PICKFORGE_STORAGE_MODE'], 'project-local');
    expect(env.containsKey('PICKFORGE_HOME'), isTrue);
    // No active run session wrote ipc.sock-path, so the endpoint is omitted.
    expect(env.containsKey('PICKFORGE_IPC_ENDPOINT'), isFalse);
    // The base shell env survives the merge.
    expect(env['PATH'], '/usr/bin');

    final parked = getIt<PtySessionPool>().parkAll();
    await settleRealIo(tester);
    await tester.runAsync(() => parked);
  });
}
