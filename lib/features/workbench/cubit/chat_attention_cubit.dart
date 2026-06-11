import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/notifications/forge_chime.dart';
import 'package:pickforge/core/notifications/notification_settings.dart';
import 'package:pickforge/core/terminal/pty_session.dart';

/// Which panes are waiting for the user, grouped by chat.
class ChatAttentionState extends Equatable {
  const ChatAttentionState(this.panesByChat);

  static const empty = ChatAttentionState({});

  /// chatId → paneIds whose shell finished work / rang the bell.
  final Map<String, Set<String>> panesByChat;

  bool chatHasAttention(String chatId) =>
      panesByChat[chatId]?.isNotEmpty ?? false;

  bool paneHasAttention(String chatId, String paneId) =>
      panesByChat[chatId]?.contains(paneId) ?? false;

  @override
  List<Object?> get props => [
        // Equatable compares by value; flatten for stable comparison.
        for (final entry in panesByChat.entries) ...[
          entry.key,
          ...entry.value.toList()..sort(),
        ],
      ];
}

/// Watches every pooled terminal session and decides when a chat needs the
/// user: a terminal bell (BEL outside escape strings — agents ring it when
/// they finish), or a meaningful burst of output followed by quiet (the
/// agent streamed its work and is now sitting at the prompt).
///
/// Attention is suppressed for the pane the user is actively looking at
/// (focused pane while the app window is foreground) and cleared the moment
/// a pane gains focus or receives keystrokes.
class ChatAttentionCubit extends Cubit<ChatAttentionState> {
  ChatAttentionCubit({
    required ForgeChime chime,
    required NotificationSettingsRepository settings,
    bool Function()? appFocused,
    this.quietDuration = const Duration(seconds: 2),
    this.workThresholdBytes = 1024,
    this.minBusySpan = const Duration(milliseconds: 1500),
    this.soundCooldown = const Duration(seconds: 3),
  })  : _chime = chime,
        _settings = settings,
        _appFocused = appFocused ?? _defaultAppFocused,
        super(ChatAttentionState.empty);

  final ForgeChime _chime;
  final NotificationSettingsRepository _settings;
  final bool Function() _appFocused;

  /// Silence needed after a burst before the pane counts as ready.
  final Duration quietDuration;

  /// Minimum output volume for a burst to count as work (filters keystroke
  /// echo and prompt redraws).
  final int workThresholdBytes;

  /// Minimum burst span for the idle heuristic (filters one-shot redraws
  /// from resizes and pane remounts).
  final Duration minBusySpan;

  /// Per-session floor between chimes so bell + idle never double-ring.
  final Duration soundCooldown;

  final _monitors = <String, _PaneMonitor>{};
  String? _activeSessionId;

  static bool _defaultAppFocused() =>
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;

  /// Starts (or rebinds) attention tracking for a pooled session. Idempotent:
  /// pane remounts re-call this for the same live session.
  void track({
    required PtySession session,
    required String sessionId,
    required String chatId,
    required String paneId,
  }) {
    final existing = _monitors[sessionId];
    if (existing != null && existing.session == session) return;
    existing?.dispose();
    _monitors[sessionId] = _PaneMonitor(
      cubit: this,
      session: session,
      sessionId: sessionId,
      chatId: chatId,
      paneId: paneId,
    );
  }

  /// Stops tracking and drops any indicator (pane closed / session disposed).
  void untrack(String sessionId) {
    final monitor = _monitors.remove(sessionId);
    if (monitor == null) return;
    monitor.dispose();
    _clear(monitor.chatId, monitor.paneId);
  }

  /// The pane the user is looking at; its ready events are not notifications.
  void setActiveSession(String? sessionId) {
    _activeSessionId = sessionId;
    if (sessionId != null) markSeen(sessionId);
  }

  /// Drops the active marker if [sessionId] still holds it (pane unmounted).
  void clearActiveSession(String sessionId) {
    if (_activeSessionId == sessionId) _activeSessionId = null;
  }

  /// Clears the indicator (pane focused, or user typed into it).
  void markSeen(String sessionId) {
    final monitor = _monitors[sessionId];
    if (monitor == null) return;
    _clear(monitor.chatId, monitor.paneId);
  }

  void _onReady(_PaneMonitor monitor) {
    final watching = monitor.sessionId == _activeSessionId && _appFocused();
    if (watching) return;

    final panes = {
      for (final entry in state.panesByChat.entries)
        entry.key: {...entry.value},
    };
    panes.putIfAbsent(monitor.chatId, () => <String>{}).add(monitor.paneId);
    emit(ChatAttentionState(panes));

    final now = clock();
    if (monitor.lastChimeAt != null &&
        now.difference(monitor.lastChimeAt!) < soundCooldown) {
      return;
    }
    monitor.lastChimeAt = now;
    unawaited(_playChime());
  }

  Future<void> _playChime() async {
    try {
      final settings = await _settings.load();
      if (!settings.chatReadySoundEnabled) return;
      await _chime.playChatReady();
    } on Object {
      // Sound is feedback, never a dependency.
    }
  }

  void _clear(String chatId, String paneId) {
    final current = state.panesByChat[chatId];
    if (current == null || !current.contains(paneId)) return;
    final panes = {
      for (final entry in state.panesByChat.entries)
        entry.key: {...entry.value},
    };
    panes[chatId]!.remove(paneId);
    if (panes[chatId]!.isEmpty) panes.remove(chatId);
    emit(ChatAttentionState(panes));
  }

  /// Injectable time source (tests override it to control burst spans).
  DateTime Function() clock = DateTime.now;

  @override
  Future<void> close() async {
    for (final monitor in _monitors.values) {
      monitor.dispose();
    }
    _monitors.clear();
    await super.close();
  }
}

/// Per-session output observer: a byte-level scanner that detects the
/// terminal bell outside escape strings, plus a burst→quiet activity
/// heuristic for shells/agents that never ring it.
class _PaneMonitor {
  _PaneMonitor({
    required this.cubit,
    required this.session,
    required this.sessionId,
    required this.chatId,
    required this.paneId,
  }) {
    _sub = session.output.listen(_onChunk, onDone: _onDone);
    _inputSub = session.input.listen((_) => _onInput());
  }

  final ChatAttentionCubit cubit;
  final PtySession session;
  final String sessionId;
  final String chatId;
  final String paneId;

  StreamSubscription<List<int>>? _sub;
  StreamSubscription<void>? _inputSub;
  Timer? _quietTimer;
  int _burstBytes = 0;
  DateTime? _burstStartedAt;
  DateTime? lastChimeAt;
  _ScanState _scan = _ScanState.ground;

  /// The idle heuristic only arms after the session received input: a fresh
  /// shell's prompt burst (or a TUI's startup paint) is not finished work,
  /// because no work was ever requested. The bell stays always-on.
  bool _sawInput = false;

  static const _bel = 0x07;
  static const _esc = 0x1b;

  void _onChunk(List<int> bytes) {
    var bell = false;
    for (final byte in bytes) {
      switch (_scan) {
        case _ScanState.ground:
          if (byte == _bel) {
            bell = true;
          } else if (byte == _esc) {
            _scan = _ScanState.escape;
          }
        case _ScanState.escape:
          // OSC (]) / DCS (P) / APC (_) / PM (^) / SOS (X) open a string
          // mode where BEL is a terminator, not a bell.
          _scan = switch (byte) {
            0x5d || 0x50 || 0x5f || 0x5e || 0x58 => _ScanState.string,
            _esc => _ScanState.escape,
            _ => _ScanState.ground,
          };
        case _ScanState.string:
          if (byte == _bel) {
            _scan = _ScanState.ground; // BEL-terminated OSC: not a bell.
          } else if (byte == _esc) {
            _scan = _ScanState.stringEscape;
          }
        case _ScanState.stringEscape:
          // ESC \ (ST) ends the string; anything else stays inside it.
          _scan = byte == 0x5c ? _ScanState.ground : _ScanState.string;
      }
    }

    final now = cubit.clock();
    _burstStartedAt ??= now;
    _burstBytes += bytes.length;
    _quietTimer?.cancel();

    if (bell) {
      _resetBurst();
      cubit._onReady(this);
      return;
    }

    _quietTimer = Timer(cubit.quietDuration, _onQuiet);
  }

  void _onInput() {
    _sawInput = true;
    // The echo/redraw caused by this input starts a fresh work cycle.
    _resetBurst();
  }

  void _onQuiet() {
    final start = _burstStartedAt;
    final span = start == null
        ? Duration.zero
        : cubit.clock().difference(start) - cubit.quietDuration;
    final meaningful = _sawInput &&
        _burstBytes >= cubit.workThresholdBytes &&
        span >= cubit.minBusySpan;
    _resetBurst();
    if (meaningful) cubit._onReady(this);
  }

  void _resetBurst() {
    _quietTimer?.cancel();
    _quietTimer = null;
    _burstBytes = 0;
    _burstStartedAt = null;
  }

  void _onDone() => cubit.untrack(sessionId);

  void dispose() {
    _quietTimer?.cancel();
    unawaited(_sub?.cancel());
    unawaited(_inputSub?.cancel());
    _sub = null;
    _inputSub = null;
  }
}

enum _ScanState { ground, escape, string, stringEscape }
