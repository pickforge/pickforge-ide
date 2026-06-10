import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/git/git_branch_probe.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/terminal/live_terminal_output.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';
import 'package:pickforge/core/terminal/shell_invocation.dart';
import 'package:pickforge/core/terminal/terminal_paste_controller.dart';
import 'package:pickforge/core/terminal/terminal_themes.dart';
import 'package:pickforge/core/terminal/transcript_recorder.dart';
import 'package:pickforge/core/terminal/transcript_replayer.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_cubit.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_state.dart';
import 'package:pickforge/features/workbench/view/agent_launch_chips.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/components/components.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';
import 'package:xterm/xterm.dart';

/// Pool/transcript key for a pane. The first pane keeps the bare chatId so
/// existing sessions and transcripts carry over.
String paneSessionId(String chatId, String paneId) =>
    paneId == 'main' ? chatId : '$chatId--$paneId';

/// The chat's terminal area: quick-launch chips + a splittable tree of
/// shell panes (left/right/top/bottom), each with its own PTY.
class TerminalPaneHost extends StatefulWidget {
  const TerminalPaneHost({
    required this.chat,
    required this.projectRoot,
    super.key,
  });

  final ChatRow chat;
  final String projectRoot;

  @override
  State<TerminalPaneHost> createState() => _TerminalPaneHostState();
}

class _TerminalPaneHostState extends State<TerminalPaneHost> {
  /// Whether the focused pane's shell is running (gates the chips).
  final _focusedRunning = ValueNotifier<bool>(false);
  late final TerminalPanesCubit _cubit = TerminalPanesCubit(
    chatId: widget.chat.chatId,
    store: getIt.isRegistered<TerminalPaneLayoutStore>()
        ? getIt<TerminalPaneLayoutStore>()
        : null,
  );

  @override
  void dispose() {
    unawaited(_cubit.close());
    _focusedRunning.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: BlocBuilder<TerminalPanesCubit, TerminalPanesState>(
        builder: (context, state) {
          final theme = Theme.of(context);
          return ColoredBox(
            color: theme.colorScheme.surface,
            child: Column(
              children: [
                ValueListenableBuilder<bool>(
                  valueListenable: _focusedRunning,
                  builder: (context, running, _) => AgentLaunchChips(
                    projectRoot: widget.projectRoot,
                    chatAgentId: widget.chat.agentId,
                    enabled: running,
                    onLaunch: (command) {
                      getIt<PtySessionPool>().typeText(
                        paneSessionId(
                          widget.chat.chatId,
                          _cubit.state.focusedPaneId,
                        ),
                        command,
                      );
                    },
                  ),
                ),
                Expanded(
                  child: state.fullscreenPaneId != null &&
                          state.leaf(state.fullscreenPaneId!) != null
                      ? _buildLeaf(state.leaf(state.fullscreenPaneId!)!, state)
                      : _buildNode(state.root, state),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildNode(PaneNode node, TerminalPanesState state) {
    switch (node) {
      case PaneLeaf():
        return _buildLeaf(node, state);
      case PaneSplit(:final axis, :final children):
        final signature = children.map((c) => c.id).join('|');
        return MultiSplitView(
          key: ValueKey('split-${node.id}-$signature'),
          axis: axis,
          initialAreas: [
            for (final child in children)
              Area(builder: (_, __) => _buildNode(child, state)),
          ],
        );
    }
  }

  Widget _buildLeaf(PaneLeaf leaf, TerminalPanesState state) {
    return TerminalPane(
      // GlobalObjectKey keeps the live terminal alive when splits reshuffle
      // the tree around it.
      key: GlobalObjectKey('terminal-pane-${widget.chat.chatId}-${leaf.id}'),
      chatId: widget.chat.chatId,
      projectRoot: widget.projectRoot,
      pane: leaf,
      isFocused: state.focusedPaneId == leaf.id,
      isFullscreen: state.fullscreenPaneId == leaf.id,
      canClose: state.leaves.length > 1,
      onRunningChanged: (paneId, {required running}) {
        if (!mounted) return;
        if (_cubit.state.focusedPaneId == paneId) {
          _focusedRunning.value = running;
        }
      },
    );
  }
}

class TerminalPane extends StatefulWidget {
  const TerminalPane({
    required this.chatId,
    required this.projectRoot,
    required this.pane,
    required this.isFocused,
    required this.isFullscreen,
    required this.canClose,
    required this.onRunningChanged,
    super.key,
  });

  final String chatId;
  final String projectRoot;
  final PaneLeaf pane;
  final bool isFocused;
  final bool isFullscreen;
  final bool canClose;
  final void Function(String paneId, {required bool running}) onRunningChanged;

  @override
  State<TerminalPane> createState() => _TerminalPaneState();
}

class _TerminalPaneState extends State<TerminalPane> {
  late final Terminal _terminal;
  late final TranscriptRecorder _recorder;
  final _focusNode = FocusNode();
  final _controller = TerminalController();
  final _pasteController = TerminalPasteController();
  StreamSubscription<String>? _outputSub;
  StreamSubscription<PtySessionState>? _stateSub;
  PtySession? _session;
  int? _lastCols;
  int? _lastRows;
  var _disposed = false;
  var _running = false;
  GitBranchInfo? _branch;
  Timer? _branchTimer;
  PaneSplitDirection? _dropHint;
  late TerminalTheme _theme;
  late TerminalStyle _textStyle;
  static const _utf8Decoder = Utf8Decoder(allowMalformed: true);

  String get _sessionId => paneSessionId(widget.chatId, widget.pane.id);

  // Brand mono first, then Nerd Font + common monos for box-drawing /
  // powerline glyph coverage that Geist Mono may not carry.
  static const _fontFallback = <String>[
    'JetBrainsMono Nerd Font',
    'JetBrains Mono',
    'Fira Code',
    'FiraCode Nerd Font',
    'DejaVu Sans Mono',
    'Liberation Mono',
    'Menlo',
    'Consolas',
    'Courier New',
    'monospace',
  ];

  @override
  void initState() {
    super.initState();
    _applySettings(EmbeddedTerminalSettings.defaults);
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
      chatId: _sessionId,
    );
    _focusNode.addListener(_onFocusChanged);
    unawaited(_probeBranch());
    _branchTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_probeBranch()),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_disposed && mounted) unawaited(_init());
    });
  }

  void _onFocusChanged() {
    if (!_focusNode.hasFocus || _disposed || !mounted) return;
    context.read<TerminalPanesCubit>().focusPane(widget.pane.id);
    _registerPasteDelegate();
  }

  void _registerPasteDelegate() {
    // "Forge it" pastes address the chat; route them to this pane while it
    // holds focus.
    getIt<PtySessionPool>()
        .registerPasteDelegate(widget.chatId, _terminal.paste);
  }

  Future<void> _probeBranch() async {
    if (_disposed || !getIt.isRegistered<ProcessRunner>()) return;
    final info =
        await GitBranchProbe(getIt<ProcessRunner>()).probe(widget.projectRoot);
    if (_disposed || !mounted || info == _branch) return;
    setState(() => _branch = info);
  }

  Future<void> _init() async {
    // Apply saved terminal settings before any writes so we never rebuild the
    // TerminalView mid-replay (a setState during replay can race xterm's
    // buffer attachment and throw during large scrollback replay).
    await _loadTerminalSettings();
    if (_disposed || !mounted) return;
    await _recorder.open();
    if (_disposed || !mounted) return;

    // Replay any prior scrollback before attaching the live PTY.
    final replayer = TranscriptReplayer(
      projectRoot: widget.projectRoot,
      chatId: _sessionId,
    );
    await for (final chunk in replayer.replay()) {
      if (_disposed || !mounted) return;
      _writeTerminal(_utf8Decoder.convert(chunk));
    }
    resetReplayedTerminalModes(_terminal);

    final pool = getIt<PtySessionPool>();
    final shell = ShellInvocationResolver().resolve();

    _session = await pool.activate(
      chatId: _sessionId,
      create: () => PtySession(
        chatId: _sessionId,
        executable: shell.executable,
        arguments: shell.arguments,
        workingDirectory: widget.projectRoot,
        factory: getIt<PtyProcessFactory>(),
        onOutput: _recorder.append,
      ),
    );
    if (_disposed || !mounted) return;
    // A pooled session predating this pane keeps recording into the fresh
    // transcript sink.
    _session!.onOutput = _recorder.append;

    if (_lastCols != null && _lastRows != null) {
      _session!.resize(_lastRows!, _lastCols!);
    }

    _outputSub = _session!.output
        .transform(const Utf8Decoder(allowMalformed: true))
        .listen(_writeTerminal);

    _stateSub = _session!.state.listen((s) {
      if (_disposed || !mounted) return;
      final running = s is PtyRunning;
      if (running != _running) {
        setState(() => _running = running);
        widget.onRunningChanged(widget.pane.id, running: running);
      }
      switch (s) {
        case PtyExited(:final code):
          _writeTerminal(
            '\r\n\x1b[33m[${shell.executable} exited '
            'with code $code]\x1b[0m\r\n',
          );
        case PtyFailed(:final message):
          _writeTerminal(
            '\r\n\x1b[31m[${shell.executable} failed: '
            '$message]\x1b[0m\r\n',
          );
        case PtyParked():
        case PtySpawning():
        case PtyRunning():
          break;
      }
    });

    _terminal.onOutput = (data) => _session?.write(utf8.encode(data));
    if (widget.isFocused) {
      _registerPasteDelegate();
      widget.onRunningChanged(widget.pane.id, running: _running);
    }
  }

  void _applySettings(EmbeddedTerminalSettings settings) {
    _theme = resolveTerminalTheme(settings.themeId);
    _textStyle = TerminalStyle(
      fontFamily: settings.fontFamily,
      fontFamilyFallback: _fontFallback,
      fontSize: settings.fontSize,
      height: 1.3,
    );
  }

  Future<void> _loadTerminalSettings() async {
    if (!getIt.isRegistered<EmbeddedTerminalSettingsRepository>()) return;
    final settings = await getIt<EmbeddedTerminalSettingsRepository>().load();
    if (_disposed || !mounted) return;
    setState(() => _applySettings(settings));
  }

  void _writeTerminal(String data) {
    if (_disposed || !mounted || data.isEmpty) return;
    try {
      writeLiveTerminalOutput(_terminal, data);
    } on Object catch (_) {
      // Defensive: a renderer hiccup (e.g. a debug-only xterm buffer
      // assertion during large scrollback replay) must never crash the pane.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _branchTimer?.cancel();
    _terminal.onResize = null;
    _terminal.onOutput = null;
    unawaited(_outputSub?.cancel());
    unawaited(_stateSub?.cancel());
    unawaited(_recorder.close());
    _focusNode
      ..removeListener(_onFocusChanged)
      ..dispose();
    _controller.dispose();
    super.dispose();
  }

  void _smartPaste() {
    final session = _session;
    if (session == null) return;
    unawaited(
      _pasteController.paste(
        projectRoot: widget.projectRoot,
        typeText: session.typeText,
        // Terminal.paste brackets only when the foreground app enabled
        // bracketed paste and routes through onOutput → session.write.
        pasteText: _terminal.paste,
      ),
    );
  }

  bool _copySelection() {
    final selection = _controller.selection;
    if (selection == null) return false;
    final text = _terminal.buffer.getText(selection);
    if (text.isEmpty) return false;
    unawaited(Clipboard.setData(ClipboardData(text: text)));
    _controller.clearSelection();
    return true;
  }

  KeyEventResult _onTerminalKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final keys = HardwareKeyboard.instance;
    final paste = (keys.isControlPressed &&
            keys.isShiftPressed &&
            event.logicalKey == LogicalKeyboardKey.keyV) ||
        (keys.isMetaPressed && event.logicalKey == LogicalKeyboardKey.keyV);
    if (paste) {
      _smartPaste();
      return KeyEventResult.handled;
    }
    final copy = (keys.isControlPressed &&
            keys.isShiftPressed &&
            event.logicalKey == LogicalKeyboardKey.keyC) ||
        (keys.isMetaPressed && event.logicalKey == LogicalKeyboardKey.keyC);
    if (copy && _copySelection()) return KeyEventResult.handled;
    return KeyEventResult.ignored;
  }

  Future<void> _showContextMenu(Offset globalPosition) async {
    final l10n = AppLocalizations.of(context);
    final overlay =
        Overlay.of(context).context.findRenderObject()! as RenderBox;
    final action = await showMenu<String>(
      context: context,
      position: RelativeRect.fromRect(
        globalPosition & const Size(1, 1),
        Offset.zero & overlay.size,
      ),
      items: [
        PopupMenuItem(
          value: 'copy',
          enabled: _controller.selection != null,
          child: Text(l10n.terminalCopy),
        ),
        PopupMenuItem(value: 'paste', child: Text(l10n.terminalPaste)),
      ],
    );
    switch (action) {
      case 'copy':
        _copySelection();
      case 'paste':
        _smartPaste();
    }
    _focusNode.requestFocus();
  }

  PaneSplitDirection _directionFor(Offset local, Size size) {
    final dx = local.dx / size.width - 0.5;
    final dy = local.dy / size.height - 0.5;
    if (dx.abs() >= dy.abs()) {
      return dx < 0 ? PaneSplitDirection.left : PaneSplitDirection.right;
    }
    return dy < 0 ? PaneSplitDirection.up : PaneSplitDirection.down;
  }

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<TerminalPanesCubit>();
    return DragTarget<String>(
      onWillAcceptWithDetails: (details) => details.data != widget.pane.id,
      onMove: (details) {
        final box = context.findRenderObject() as RenderBox?;
        if (box == null) return;
        final hint = _directionFor(box.globalToLocal(details.offset), box.size);
        if (hint != _dropHint) setState(() => _dropHint = hint);
      },
      onLeave: (_) => setState(() => _dropHint = null),
      onAcceptWithDetails: (details) {
        final box = context.findRenderObject() as RenderBox?;
        final direction = box == null
            ? PaneSplitDirection.right
            : _directionFor(box.globalToLocal(details.offset), box.size);
        setState(() => _dropHint = null);
        cubit.move(details.data, widget.pane.id, direction);
      },
      builder: (context, candidates, _) => Stack(
        children: [
          Positioned.fill(
            child: Column(
              children: [
                _PaneHeader(
                  pane: widget.pane,
                  branch: _branch,
                  isFocused: widget.isFocused,
                  isFullscreen: widget.isFullscreen,
                  canClose: widget.canClose,
                  onSplit: (direction) =>
                      cubit.split(widget.pane.id, direction),
                  onFullscreen: () => cubit.toggleFullscreen(widget.pane.id),
                  onClose: () {
                    unawaited(getIt<PtySessionPool>().detach(_sessionId));
                    cubit.closePane(widget.pane.id);
                  },
                ),
                Expanded(
                  child: ColoredBox(
                    color: _theme.background,
                    child: TerminalView(
                      _terminal,
                      controller: _controller,
                      focusNode: _focusNode,
                      theme: _theme,
                      textStyle: _textStyle,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      // No default shortcuts: plain Ctrl+V / Ctrl+A must
                      // reach the shell and TUIs; copy/paste live in
                      // _onTerminalKey.
                      shortcuts: const {},
                      onKeyEvent: _onTerminalKey,
                      onSecondaryTapUp: (details, _) =>
                          unawaited(_showContextMenu(details.globalPosition)),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (candidates.isNotEmpty && _dropHint != null)
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedAlign(
                  duration:
                      ReduceMotion.duration(context, PickforgeMotion.fast),
                  curve: PickforgeMotion.forge,
                  alignment: switch (_dropHint!) {
                    PaneSplitDirection.left => Alignment.centerLeft,
                    PaneSplitDirection.right => Alignment.centerRight,
                    PaneSplitDirection.up => Alignment.topCenter,
                    PaneSplitDirection.down => Alignment.bottomCenter,
                  },
                  child: FractionallySizedBox(
                    widthFactor: _dropHint!.axis == Axis.horizontal ? 0.5 : 1,
                    heightFactor: _dropHint!.axis == Axis.vertical ? 0.5 : 1,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: PickforgeColors.emberGlow,
                        border: Border.all(color: PickforgeColors.ember),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PaneHeader extends StatelessWidget {
  const _PaneHeader({
    required this.pane,
    required this.branch,
    required this.isFocused,
    required this.isFullscreen,
    required this.canClose,
    required this.onSplit,
    required this.onFullscreen,
    required this.onClose,
  });

  final PaneLeaf pane;
  final GitBranchInfo? branch;
  final bool isFocused;
  final bool isFullscreen;
  final bool canClose;
  final void Function(PaneSplitDirection direction) onSplit;
  final VoidCallback onFullscreen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final header = Container(
      height: 30,
      padding: const EdgeInsets.symmetric(horizontal: PickforgeSpacing.sm),
      decoration: const BoxDecoration(
        color: PickforgeColors.surface1,
        border: Border(bottom: BorderSide(color: PickforgeColors.hairline)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.drag_indicator,
            size: 12,
            color: PickforgeColors.textLow,
          ),
          const SizedBox(width: PickforgeSpacing.xs),
          MonoEyebrow(
            pane.name,
            color: isFocused ? PickforgeColors.ember : PickforgeColors.textMed,
          ),
          if (branch case final branch?) ...[
            const SizedBox(width: PickforgeSpacing.sm),
            Flexible(
              child: Text(
                branch.isWorktree
                    ? '⎇ ${branch.branch} · ${l10n.terminalPaneWorktree}'
                    : '⎇ ${branch.branch}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: PickforgeText.eyebrow
                    .copyWith(color: PickforgeColors.textLow),
              ),
            ),
          ],
          const Spacer(),
          PopupMenuButton<PaneSplitDirection>(
            tooltip: l10n.terminalPaneSplit,
            icon: const Icon(
              Icons.splitscreen_outlined,
              size: 14,
              color: PickforgeColors.textMed,
            ),
            onSelected: onSplit,
            itemBuilder: (context) => [
              PopupMenuItem(
                value: PaneSplitDirection.left,
                child: Text(l10n.terminalPaneSplitLeft),
              ),
              PopupMenuItem(
                value: PaneSplitDirection.right,
                child: Text(l10n.terminalPaneSplitRight),
              ),
              PopupMenuItem(
                value: PaneSplitDirection.up,
                child: Text(l10n.terminalPaneSplitUp),
              ),
              PopupMenuItem(
                value: PaneSplitDirection.down,
                child: Text(l10n.terminalPaneSplitDown),
              ),
            ],
          ),
          IconButton(
            tooltip: isFullscreen
                ? l10n.terminalPaneExitFullscreen
                : l10n.terminalPaneFullscreen,
            visualDensity: VisualDensity.compact,
            icon: Icon(
              isFullscreen ? Icons.fullscreen_exit : Icons.fullscreen,
              size: 14,
              color: PickforgeColors.textMed,
            ),
            onPressed: onFullscreen,
          ),
          IconButton(
            tooltip: l10n.terminalPaneClose,
            visualDensity: VisualDensity.compact,
            icon: const Icon(
              Icons.close,
              size: 14,
              color: PickforgeColors.textMed,
            ),
            onPressed: canClose ? onClose : null,
          ),
        ],
      ),
    );
    return Draggable<String>(
      data: pane.id,
      feedback: Material(
        color: Colors.transparent,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: PickforgeSpacing.md,
            vertical: PickforgeSpacing.xs,
          ),
          decoration: BoxDecoration(
            color: PickforgeColors.surface3,
            borderRadius: BorderRadius.circular(PickforgeSpacing.radiusPill),
            border: Border.all(color: PickforgeColors.ember),
          ),
          child: MonoEyebrow(pane.name, color: PickforgeColors.ember),
        ),
      ),
      child: header,
    );
  }
}
