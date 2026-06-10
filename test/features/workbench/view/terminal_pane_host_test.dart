import 'dart:async';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_cubit.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_state.dart';
import 'package:pickforge/features/workbench/view/terminal_pane_host.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

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
  @override
  Future<PtyProcess> start({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    Map<String, String>? environment,
    int rows = 24,
    int cols = 80,
  }) async =>
      _FakePtyProcess();
}

void main() {
  late Directory projectRoot;
  late TerminalPanesCubit cubit;

  setUp(() async {
    projectRoot = await Directory.systemTemp.createTemp('pickforge-panes-');
    await getIt.reset();
    getIt
      ..registerSingleton<PtySessionPool>(PtySessionPool())
      ..registerSingleton<PtyProcessFactory>(_FakeFactory());
    cubit = TerminalPanesCubit(chatId: 'chat-1');
  });

  tearDown(() async {
    await getIt<PtySessionPool>().parkAll();
    await getIt.reset();
    await cubit.close();
    await projectRoot.delete(recursive: true);
  });

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
    await tester.pumpAndSettle();

    final root = cubit.state.root as PaneSplit;
    expect(root.axis, Axis.vertical);
    expect(root.children.first.id, added);
    expect(root.children.last.id, 'main');
  });

  testWidgets('the close button removes the pane', (tester) async {
    cubit.split('main', PaneSplitDirection.right);
    await pumpPanes(tester);

    await tester.tap(find.byTooltip('Close terminal').last);
    await tester.pumpAndSettle();

    expect(cubit.state.leaves.map((l) => l.id), ['main']);
  });
}
