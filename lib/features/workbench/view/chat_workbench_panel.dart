import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/core/terminal/transcript_recorder.dart';
import 'package:pickforge/core/terminal/transcript_replayer.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:xterm/xterm.dart';

class ChatWorkbenchPanel extends StatelessWidget {
  const ChatWorkbenchPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatsCubit, ChatsState>(
      builder: (context, state) {
        if (state is! ChatsReady || state.activeChatId == null) {
          return const _EmptyChat();
        }
        final active = state.chats.firstWhere(
          (c) => c.chatId == state.activeChatId,
        );
        return _ChatTerminal(
          key: ValueKey(active.chatId),
          chat: active,
          projectRoot: state.projectRoot,
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
  StreamSubscription<List<int>>? _outputSub;
  PtySession? _session;

  @override
  void initState() {
    super.initState();
    _terminal = Terminal(maxLines: 10000);
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
      _terminal.write(String.fromCharCodes(chunk));
    }

    final pool = getIt<PtySessionPool>();
    final agentId = AgentProfileId.fromValue(widget.chat.agentId);
    final agent = getIt<AgentProfileRegistry>().get(agentId);
    final invocation = agent.ptyArgsFor(resumeSessionId: widget.chat.sessionId);

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

    _outputSub = _session!.output.listen((bytes) {
      _terminal.write(String.fromCharCodes(bytes));
    });

    _terminal.onOutput = (data) => _session?.write(data.codeUnits);
  }

  @override
  void dispose() {
    unawaited(_outputSub?.cancel());
    unawaited(_recorder.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TerminalView(_terminal);
  }
}
