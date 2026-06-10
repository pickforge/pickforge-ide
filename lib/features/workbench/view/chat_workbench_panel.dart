import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/core/agent/headless/chat_message.dart';
import 'package:pickforge/core/agent/headless/headless_chat_feature_flags.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session.dart';
import 'package:pickforge/core/agent/headless/headless_chat_session_pool.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/emulator/view/run_logs_pane.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';
import 'package:pickforge/features/workbench/view/terminal_pane_host.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/components/components.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

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
                _ActiveChatPane(
                  key: ValueKey(activeChat.chatId),
                  chat: activeChat,
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

class _ActiveChatPane extends StatelessWidget {
  const _ActiveChatPane({required this.chat, super.key});

  final ChatRow chat;

  @override
  Widget build(BuildContext context) {
    final agentId = AgentProfileId.fromValue(chat.agentId);
    final flags = getIt.isRegistered<HeadlessChatFeatureFlags>()
        ? getIt<HeadlessChatFeatureFlags>()
        : const HeadlessChatFeatureFlags();
    final headlessPool = getIt.isRegistered<HeadlessChatSessionPool>()
        ? getIt<HeadlessChatSessionPool>()
        : null;
    if (flags.enabled(agentId) && headlessPool?.supports(agentId) == true) {
      return _HeadlessChatPane(
        chat: chat,
        projectRoot: chat.projectRoot,
        agentId: agentId,
      );
    }
    return TerminalPaneHost(chat: chat, projectRoot: chat.projectRoot);
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ColoredBox(
      color: Theme.of(context).colorScheme.surface,
      child: Stack(
        children: [
          const Positioned.fill(
            child: IgnorePointer(child: BlueprintGrid()),
          ),
          ForgeEmptyState(
            icon: Icons.terminal_outlined,
            eyebrow: 'Terminal',
            title: l10n.chatSelectOrCreate,
            hint: l10n.chatEmptyHint,
          ),
        ],
      ),
    );
  }
}

class _HeadlessChatPane extends StatefulWidget {
  const _HeadlessChatPane({
    required this.chat,
    required this.projectRoot,
    required this.agentId,
  });

  final ChatRow chat;
  final String projectRoot;
  final AgentProfileId agentId;

  @override
  State<_HeadlessChatPane> createState() => _HeadlessChatPaneState();
}

class _HeadlessChatPaneState extends State<_HeadlessChatPane> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  StreamSubscription<ChatMessage>? _messageSub;
  HeadlessChatSession? _session;
  List<ChatMessage> _messages = const [];

  @override
  void initState() {
    super.initState();
    unawaited(_init());
  }

  @override
  void dispose() {
    unawaited(_messageSub?.cancel());
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    final session = await getIt<HeadlessChatSessionPool>().activate(
      chatId: widget.chat.chatId,
      projectRoot: widget.projectRoot,
      agentId: widget.agentId,
      resumeSessionId: widget.chat.sessionId,
    );
    if (!mounted) return;
    setState(() {
      _session = session;
      _messages = session.history;
    });
    _messageSub = session.messages.listen((message) {
      if (!mounted) return;
      setState(() => _messages = [..._messages, message]);
      _scrollToBottom();
    });
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _input.clear();
    final session = _session;
    if (session == null) return;
    unawaited(session.sendPrompt(text));
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      if (ReduceMotion.of(context)) {
        _scroll.jumpTo(_scroll.position.maxScrollExtent);
        return;
      }
      unawaited(
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final l10n = Localizations.of<AppLocalizations>(
      context,
      AppLocalizations,
    );
    return ColoredBox(
      color: colorScheme.surface,
      child: Column(
        children: [
          SizedBox(
            height: 44,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  Icon(
                    Icons.forum_outlined,
                    size: 18,
                    color: colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      l10n?.headlessChatTitle ?? 'Headless adapter',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Text(
                      l10n?.headlessChatEmpty ?? 'No messages yet',
                      style: TextStyle(color: colorScheme.onSurfaceVariant),
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.all(12),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      return _HeadlessMessageBubble(message: _messages[index]);
                    },
                  ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    textInputAction: TextInputAction.newline,
                    decoration: InputDecoration(
                      hintText:
                          l10n?.headlessChatInputHint ?? 'Message the agent',
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  tooltip: l10n?.headlessChatSend ?? 'Send',
                  onPressed: _send,
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeadlessMessageBubble extends StatelessWidget {
  const _HeadlessMessageBubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final isUser = message.role == ChatMessageRole.user;
    final background = switch (message.role) {
      ChatMessageRole.user => colorScheme.primaryContainer,
      ChatMessageRole.assistant => colorScheme.surfaceContainerHighest,
      ChatMessageRole.system => colorScheme.secondaryContainer,
      ChatMessageRole.error => colorScheme.errorContainer,
    };
    final foreground = switch (message.role) {
      ChatMessageRole.user => colorScheme.onPrimaryContainer,
      ChatMessageRole.assistant => colorScheme.onSurface,
      ChatMessageRole.system => colorScheme.onSecondaryContainer,
      ChatMessageRole.error => colorScheme.onErrorContainer,
    };
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment:
                isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              Text(
                _roleLabel(context, message.role),
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: foreground.withValues(alpha: 0.72),
                    ),
              ),
              const SizedBox(height: 4),
              SelectableText(
                message.text,
                style: TextStyle(color: foreground, height: 1.35),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _roleLabel(BuildContext context, ChatMessageRole role) {
    final l10n = AppLocalizations.of(context);
    return switch (role) {
      ChatMessageRole.user => l10n.chatRoleUser,
      ChatMessageRole.assistant => l10n.chatRoleAssistant,
      ChatMessageRole.system => l10n.chatRoleSystem,
      ChatMessageRole.error => l10n.chatRoleError,
    };
  }
}
