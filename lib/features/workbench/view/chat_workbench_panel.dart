import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';
import 'package:pickforge/core/terminal/terminal_themes.dart';
import 'package:pickforge/core/terminal/transcript_recorder.dart';
import 'package:pickforge/core/terminal/transcript_replayer.dart';
import 'package:pickforge/features/emulator/view/run_logs_pane.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';
import 'package:xterm/xterm.dart';

class ChatWorkbenchPanel extends StatefulWidget {
  const ChatWorkbenchPanel({super.key});

  @override
  State<ChatWorkbenchPanel> createState() => _ChatWorkbenchPanelState();
}

class _ChatWorkbenchPanelState extends State<ChatWorkbenchPanel> {
  late final MultiSplitViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = MultiSplitViewController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WorkbenchLayoutCubit, WorkbenchLayoutState>(
      builder: (context, layout) {
        return BlocBuilder<ChatsCubit, ChatsState>(
          builder: (context, state) {
            final activeProjectRoot =
                switch (context.watch<ProjectsCubit>().state) {
              ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
              _ => null,
            };
            final chatPane = switch (state) {
              ChatsReady(:final activeChat)
                  when activeChat != null &&
                      activeChat.projectRoot == activeProjectRoot =>
                _ChatTerminal(
                  key: ValueKey(activeChat.chatId),
                  chat: activeChat,
                  projectRoot: activeChat.projectRoot,
                ),
              _ => const _EmptyChat(),
            };
            if (layout.runLogsCollapsed) return chatPane;
            _controller.areas = [
              Area(builder: (_, __) => chatPane, min: 220),
              Area(
                size: layout.runLogsHeight,
                min: 120,
                builder: (_, __) => const RunLogsPane(),
              ),
            ];
            return MultiSplitView(
              axis: Axis.vertical,
              controller: _controller,
              onDividerDragEnd: (_) {
                final height = _controller.getArea(1).size;
                context
                    .read<WorkbenchLayoutCubit>()
                    .updateSizes(runLogsHeight: height);
              },
            );
          },
        );
      },
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surface,
      child: const Center(
        child: Text('Select or create a chat to begin'),
      ),
    );
  }
}

class _ChatTerminal extends StatefulWidget {
  const _ChatTerminal({
    required this.chat,
    required this.projectRoot,
    super.key,
  });

  final ChatRow chat;
  final String projectRoot;

  @override
  State<_ChatTerminal> createState() => _ChatTerminalState();
}

class _ChatTerminalState extends State<_ChatTerminal> {
  late final Terminal _terminal;
  late final TranscriptRecorder _recorder;
  StreamSubscription<String>? _outputSub;
  StreamSubscription<PtySessionState>? _stateSub;
  PtySession? _session;
  int? _lastCols;
  int? _lastRows;
  late final TerminalTheme _theme;
  late final TerminalStyle _textStyle;
  static const _utf8Decoder = Utf8Decoder(allowMalformed: true);

  @override
  void initState() {
    super.initState();
    _theme = resolveTerminalTheme(EmbeddedTerminalSettings.defaults.themeId);
    _textStyle = TerminalStyle(
      fontFamily: 'JetBrainsMono',
      fontFamilyFallback: const [
        'JetBrainsMono Nerd Font',
        'Fira Code',
        'FiraCode Nerd Font',
        'DejaVu Sans Mono',
        'Liberation Mono',
        'Menlo',
        'Consolas',
        'Courier New',
        'monospace',
      ],
      fontSize: EmbeddedTerminalSettings.defaults.fontSize,
      height: 1.25,
    );
    _terminal = Terminal(maxLines: 10000, reflowEnabled: false);
    _terminal.onResize = (width, height, _, __) {
      _lastCols = width;
      _lastRows = height;
      // Defer the PTY ioctl out of the layout phase to avoid any chance of
      // synchronous re-entry into the widget framework during build/layout.
      final session = _session;
      if (session == null) return;
      scheduleMicrotask(() => session.resize(height, width));
    };
    _recorder = TranscriptRecorder(
      projectRoot: widget.projectRoot,
      chatId: widget.chat.chatId,
    );
    unawaited(_init());
  }

  Future<void> _init() async {
    await _recorder.open();

    // Replay any prior scrollback before attaching the live PTY.
    final replayer = TranscriptReplayer(
      projectRoot: widget.projectRoot,
      chatId: widget.chat.chatId,
    );
    await for (final chunk in replayer.replay()) {
      _terminal.write(_utf8Decoder.convert(chunk));
    }

    final pool = getIt<PtySessionPool>();
    final agentId = AgentProfileId.fromValue(widget.chat.agentId);
    final agent = getIt<AgentProfileRegistry>().get(agentId);
    final invocation = agent.ptyArgsFor(resumeSessionId: widget.chat.sessionId);

    final available =
        await getIt<BinaryDetector>().isBinaryOnPath(invocation.executable);
    if (!available) {
      _terminal.write(
        '\r\n\x1b[31mCould not start `${invocation.executable}`: '
        'binary not found on PATH.\x1b[0m\r\n'
        'Install it and make sure it is reachable from a non-interactive '
        'shell (e.g. add its directory to ~/.profile or /etc/environment).\r\n',
      );
      return;
    }

    _session = await pool.activate(
      chatId: widget.chat.chatId,
      create: () => PtySession(
        chatId: widget.chat.chatId,
        executable: invocation.executable,
        arguments: invocation.arguments,
        workingDirectory: widget.projectRoot,
        factory: getIt<PtyProcessFactory>(),
        onOutput: _recorder.append,
      ),
    );

    if (_lastCols != null && _lastRows != null) {
      _session!.resize(_lastRows!, _lastCols!);
    }

    _outputSub = _session!.output
        .transform(const Utf8Decoder(allowMalformed: true))
        .listen(_terminal.write);

    _stateSub = _session!.state.listen((s) {
      switch (s) {
        case PtyExited(:final code):
          _terminal.write(
            '\r\n\x1b[33m[${invocation.executable} exited '
            'with code $code]\x1b[0m\r\n',
          );
        case PtyFailed(:final message):
          _terminal.write(
            '\r\n\x1b[31m[${invocation.executable} failed: '
            '$message]\x1b[0m\r\n',
          );
        case PtyParked():
        case PtySpawning():
        case PtyRunning():
          break;
      }
    });

    _terminal.onOutput = (data) => _session?.write(utf8.encode(data));
  }

  @override
  void dispose() {
    _terminal.onResize = null;
    unawaited(_outputSub?.cancel());
    unawaited(_stateSub?.cancel());
    unawaited(_recorder.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: _theme.background,
      child: TerminalView(
        _terminal,
        theme: _theme,
        textStyle: _textStyle,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
    );
  }
}
