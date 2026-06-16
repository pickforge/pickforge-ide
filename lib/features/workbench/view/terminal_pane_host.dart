import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:logging/logging.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/git/git_branch_probe.dart';
import 'package:pickforge/core/process/user_shell_environment.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/storage/pickforge_env_vars.dart';
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
import 'package:pickforge/features/workbench/cubit/chat_attention_cubit.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_cubit.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_state.dart';
import 'package:pickforge/features/workbench/view/agent_launch_chips.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/components/components.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_elevation.dart';
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
        // Rebuild the split tree only when its STRUCTURE changes. A focus
        // change must never rebuild it: recreating the MultiSplitView tree
        // reparents every live terminal (GlobalKeys), which flashes the
        // canvas black and drops the keyboard focus the user just clicked
        // for. Per-pane focus styling lives in _buildLeaf's own builder.
        buildWhen: (prev, curr) =>
            prev.root != curr.root ||
            prev.fullscreenPaneId != curr.fullscreenPaneId,
        builder: (context, state) {
          // Transparent: the chips strip and pane gaps sit directly on the
          // forge backdrop; the terminal itself paints its own background.
          return ColoredBox(
            color: Colors.transparent,
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
        // Thin, transparent dividers: the rounded panes sit nearly flush and
        // the divider is only a grab handle, not a visible gap.
        return MultiSplitViewTheme(
          data: MultiSplitViewThemeData(
            dividerThickness: 5,
            dividerPainter: DividerPainters.background(
              color: Colors.transparent,
              highlightedColor: PickforgeColors.emberGlow,
            ),
          ),
          child: MultiSplitView(
            key: ValueKey('split-${node.id}-$signature'),
            axis: axis,
            initialAreas: [
              for (final child in children)
                Area(builder: (_, __) => _buildNode(child, state)),
            ],
          ),
        );
    }
  }

  Widget _buildLeaf(PaneLeaf leaf, TerminalPanesState _) {
    // Fresh state per leaf: the Area builder closures the split view holds
    // onto outlive any single build, so focus/fullscreen flags must be read
    // live, not captured.
    return BlocBuilder<TerminalPanesCubit, TerminalPanesState>(
      builder: (context, state) => TerminalPane(
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
      ),
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
  final _focusNode = FocusNode();
  final _controller = TerminalController();
  final _pasteController = TerminalPasteController(
    storage: getIt<ContextStorageService>(),
  );
  StreamSubscription<String>? _outputSub;
  StreamSubscription<PtySessionState>? _stateSub;
  PtySession? _session;
  int? _lastCols;
  int? _lastRows;
  Timer? _resizeDebounce;
  var _disposed = false;
  var _running = false;
  GitBranchInfo? _branch;
  Timer? _branchTimer;
  PaneSplitDirection? _dropHint;
  EmbeddedTerminalSettings _settings = EmbeddedTerminalSettings.defaults;
  late TerminalTheme _theme;
  late TerminalStyle _textStyle;
  static const _utf8Decoder = Utf8Decoder(allowMalformed: true);

  String get _sessionId => paneSessionId(widget.chatId, widget.pane.id);

  ChatAttentionCubit? get _attention => getIt.isRegistered<ChatAttentionCubit>()
      ? getIt<ChatAttentionCubit>()
      : null;

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
      // Coalesce the resize flood a divider drag produces: one PTY ioctl per
      // layout frame means one SIGWINCH per frame, and the shell reprints
      // its prompt for each — stacking dozens of prompt lines on release.
      // The trailing call also keeps the ioctl out of the layout phase.
      _resizeDebounce?.cancel();
      _resizeDebounce = Timer(const Duration(milliseconds: 120), () {
        final session = _session;
        if (_disposed || session == null) return;
        session.resize(height, width);
      });
    };
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
    _attention?.setActiveSession(_sessionId);
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
    // A missing project root means the user moved or deleted the folder.
    // Spawning here would recreate the old path (recorder dirs, shell cwd) —
    // surface the problem instead; the sidebar offers relocate/remove.
    if (!Directory(widget.projectRoot).existsSync()) {
      Logger('pty.pane').warning(
        'not spawning $_sessionId: project folder missing '
        '(${widget.projectRoot})',
      );
      _writeTerminal(
        '\x1b[31m[project folder not found: '
        '${widget.projectRoot}]\x1b[0m\r\n',
      );
      return;
    }

    // Pane ids recycle across closes and restarts; a pane just created by a
    // split must not replay the transcript a dead namesake left behind.
    final freshSplit =
        context.read<TerminalPanesCubit>().consumeFreshPane(widget.pane.id);

    // Apply saved terminal settings before any writes so we never rebuild the
    // TerminalView mid-replay (a setState during replay can race xterm's
    // buffer attachment and throw during large scrollback replay).
    await _loadTerminalSettings();
    if (_disposed || !mounted) return;

    final resolved =
        await getIt<ContextStorageService>().resolve(widget.projectRoot);
    if (_disposed || !mounted) return;

    if (freshSplit) {
      await TranscriptRecorder.deleteTranscript(
        chatsDir: resolved.chatsDir,
        chatId: _sessionId,
      );
      if (_disposed || !mounted) return;
    } else {
      // Replay any prior scrollback before attaching the live PTY.
      final replayer = TranscriptReplayer(
        projectRoot: widget.projectRoot,
        chatId: _sessionId,
        storage: getIt<ContextStorageService>(),
      );
      await for (final chunk in replayer.replay()) {
        if (_disposed || !mounted) return;
        _writeTerminal(_utf8Decoder.convert(chunk));
      }
    }

    final pool = getIt<PtySessionPool>();
    // A live pooled session (chat switched away and back) is exactly where
    // the replay left the terminal — a running TUI is legitimately on the
    // alt screen with its modes active, and resetting them would desync the
    // widget from the still-running program. Only a fresh spawn needs the
    // previous life's modes undone.
    final pooled = pool.session(_sessionId);
    if (pooled == null || !pooled.isRunning) {
      resetReplayedTerminalModes(_terminal);
    }

    final shell = ShellInvocationResolver().resolve();

    _session = await pool.activate(
      chatId: _sessionId,
      // The recorder belongs to the session, not the pane: it keeps
      // recording while the chat is in the background so reopening replays
      // the work that finished there, and it closes when the session does.
      create: () async {
        final recorder = TranscriptRecorder(
          projectRoot: widget.projectRoot,
          chatId: _sessionId,
          storage: getIt<ContextStorageService>(),
        );
        await recorder.open();
        final shellEnv = getIt.isRegistered<UserShellEnvironment>()
            ? getIt<UserShellEnvironment>()
            : UserShellEnvironment.instance;
        final base = await shellEnv.load();
        final sockFile = File(resolved.ipcSockPath);
        final environment = {
          ...base,
          ...pickforgeEnvVars(
            resolved,
            activeIpcEndpoint: sockFile.existsSync()
                ? sockFile.readAsStringSync().trim()
                : null,
          ),
        };
        return PtySession(
          chatId: _sessionId,
          executable: shell.executable,
          arguments: shell.arguments,
          workingDirectory: widget.projectRoot,
          environment: environment,
          factory: getIt<PtyProcessFactory>(),
          onOutput: recorder.append,
          onDispose: recorder.close,
        );
      },
    );
    if (_disposed || !mounted) return;
    _attention?.track(
      session: _session!,
      sessionId: _sessionId,
      chatId: widget.chatId,
      paneId: widget.pane.id,
    );

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

    _terminal.onOutput = (data) {
      // Keystrokes mean the user is here: drop this pane's attention flag.
      _attention?.markSeen(_sessionId);
      _session?.write(utf8.encode(data));
    };
    if (widget.isFocused) {
      _registerPasteDelegate();
      widget.onRunningChanged(widget.pane.id, running: _running);
    }
  }

  void _applySettings(EmbeddedTerminalSettings settings) {
    _settings = settings;
    _theme = resolveTerminalTheme(settings.themeId);
    _textStyle = TerminalStyle(
      fontFamily: settings.fontFamily,
      fontFamilyFallback: _fontFallback,
      fontSize: settings.fontSize,
      height: 1.3,
    );
  }

  static const _minFontSize = 8.0;
  static const _maxFontSize = 32.0;

  /// Ctrl +/−/0 zoom. The terminal reflows itself (rows/cols shrink as the
  /// font grows and the PTY is resized to match), so nothing can overflow.
  void _setFontSize(double size) {
    final clamped = size.clamp(_minFontSize, _maxFontSize);
    if (clamped == _settings.fontSize) return;
    final updated = _settings.copyWith(fontSize: clamped);
    setState(() => _applySettings(updated));
    if (getIt.isRegistered<EmbeddedTerminalSettingsRepository>()) {
      unawaited(getIt<EmbeddedTerminalSettingsRepository>().save(updated));
    }
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
    _attention?.clearActiveSession(_sessionId);
    _branchTimer?.cancel();
    _resizeDebounce?.cancel();
    _terminal.onResize = null;
    _terminal.onOutput = null;
    unawaited(_outputSub?.cancel());
    unawaited(_stateSub?.cancel());
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
    if (keys.isControlPressed || keys.isMetaPressed) {
      final key = event.logicalKey;
      if (key == LogicalKeyboardKey.equal ||
          key == LogicalKeyboardKey.add ||
          key == LogicalKeyboardKey.numpadAdd) {
        _setFontSize(_settings.fontSize + 1);
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.minus ||
          key == LogicalKeyboardKey.numpadSubtract) {
        _setFontSize(_settings.fontSize - 1);
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.digit0 ||
          key == LogicalKeyboardKey.numpad0) {
        _setFontSize(EmbeddedTerminalSettings.defaults.fontSize);
        return KeyEventResult.handled;
      }
    }
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
      builder: (context, candidates, _) => EmberSweepBorder(
        active: widget.isFocused,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
          child: Stack(
            children: [
              Positioned.fill(
                child: Column(
                  children: [
                    StreamBuilder<ChatAttentionState>(
                      stream: _attention?.stream,
                      initialData: _attention?.state,
                      builder: (context, snapshot) => _PaneHeader(
                        pane: widget.pane,
                        branch: _branch,
                        isFocused: widget.isFocused,
                        isFullscreen: widget.isFullscreen,
                        canClose: widget.canClose,
                        hasAttention: snapshot.data?.paneHasAttention(
                              widget.chatId,
                              widget.pane.id,
                            ) ??
                            false,
                        onSplit: (direction) =>
                            cubit.split(widget.pane.id, direction),
                        onFullscreen: () =>
                            cubit.toggleFullscreen(widget.pane.id),
                        onClose: () {
                          final sessionId = _sessionId;
                          final projectRoot = widget.projectRoot;
                          final isSplitPane = widget.pane.id != 'main';
                          // The recorder closes with the detach; only then
                          // drop the transcript so a future pane recycling
                          // this id starts clean. The main pane's transcript
                          // is the chat's own scrollback and stays.
                          unawaited(
                            getIt<PtySessionPool>()
                                .detach(sessionId)
                                .then((_) async {
                              if (isSplitPane) {
                                final chatsDir =
                                    (await getIt<ContextStorageService>()
                                            .resolve(projectRoot))
                                        .chatsDir;
                                await TranscriptRecorder.deleteTranscript(
                                  chatsDir: chatsDir,
                                  chatId: sessionId,
                                );
                              }
                            }),
                          );
                          cubit.closePane(widget.pane.id);
                        },
                      ),
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
                          onSecondaryTapUp: (details, _) => unawaited(
                            _showContextMenu(details.globalPosition),
                          ),
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
                        widthFactor:
                            _dropHint!.axis == Axis.horizontal ? 0.5 : 1,
                        heightFactor:
                            _dropHint!.axis == Axis.vertical ? 0.5 : 1,
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
        ),
      ),
    );
  }
}

/// Pane header action: a small raised chip so the controls read as buttons
/// against the dense terminal chrome. With [onPressed] null and no consuming
/// gesture, taps fall through to an enclosing trigger (the split menu).
class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.icon,
    this.onPressed,
    this.tooltip,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      side: BorderSide(color: PickforgeColors.hairline),
    );
    Widget button = Material(
      color: PickforgeColors.itemFill,
      shape: shape,
      child: SizedBox(
        width: 22,
        height: 22,
        child: Icon(icon, size: 13, color: PickforgeColors.textMed),
      ),
    );
    if (onPressed != null) {
      button = Material(
        color: PickforgeColors.itemFill,
        shape: shape,
        child: InkWell(
          onTap: onPressed,
          customBorder: shape,
          hoverColor: PickforgeColors.surface3,
          child: SizedBox(
            width: 22,
            height: 22,
            child: Icon(icon, size: 13, color: PickforgeColors.textMed),
          ),
        ),
      );
    }
    if (tooltip case final tooltip?) {
      button = Tooltip(message: tooltip, child: button);
    }
    return button;
  }
}

class _PaneHeader extends StatelessWidget {
  const _PaneHeader({
    required this.pane,
    required this.branch,
    required this.isFocused,
    required this.isFullscreen,
    required this.canClose,
    required this.hasAttention,
    required this.onSplit,
    required this.onFullscreen,
    required this.onClose,
  });

  final PaneLeaf pane;
  final GitBranchInfo? branch;
  final bool isFocused;
  final bool isFullscreen;
  final bool canClose;

  /// This pane finished work and is waiting for the user — glow until the
  /// pane is focused or typed into.
  final bool hasAttention;

  final void Function(PaneSplitDirection direction) onSplit;
  final VoidCallback onFullscreen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final header = AnimatedContainer(
      duration: ReduceMotion.duration(context, PickforgeMotion.fast),
      curve: PickforgeMotion.forge,
      height: 30,
      padding: const EdgeInsets.symmetric(horizontal: PickforgeSpacing.sm),
      decoration: BoxDecoration(
        color: PickforgeColors.surface1,
        border: Border(
          bottom: BorderSide(
            color: hasAttention
                ? PickforgeColors.ember.withValues(alpha: 0.55)
                : PickforgeColors.hairline,
          ),
        ),
        boxShadow: hasAttention ? PickforgeElevation.emberSoft : null,
      ),
      child: Row(
        children: [
          Icon(
            Icons.drag_indicator,
            size: 12,
            color: PickforgeColors.textLow,
          ),
          const SizedBox(width: PickforgeSpacing.xs),
          if (hasAttention) ...[
            const EmberDot(size: 6, pulsing: true),
            const SizedBox(width: PickforgeSpacing.xs),
          ],
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
            child: const _HeaderIconButton(icon: Icons.splitscreen_outlined),
          ),
          const SizedBox(width: PickforgeSpacing.xs),
          _HeaderIconButton(
            tooltip: isFullscreen
                ? l10n.terminalPaneExitFullscreen
                : l10n.terminalPaneFullscreen,
            icon: isFullscreen ? Icons.fullscreen_exit : Icons.fullscreen,
            onPressed: onFullscreen,
          ),
          const SizedBox(width: PickforgeSpacing.xs),
          _HeaderIconButton(
            tooltip: l10n.terminalPaneClose,
            icon: Icons.close,
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
