import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/pty_session.dart';

@lazySingleton
class PtySessionPool {
  final _sessions = <String, PtySession>{};
  final _pasteDelegates = <String, void Function(String)>{};

  PtySession? session(String chatId) => _sessions[chatId];

  Iterable<PtySession> get all => _sessions.values;

  void attach(PtySession s) {
    _sessions[s.chatId] = s;
  }

  Future<void> detach(String chatId) async {
    final s = _sessions.remove(chatId);
    await s?.dispose();
  }

  Future<void> parkAll() async {
    final all = List<PtySession>.from(_sessions.values);
    _sessions.clear();
    await Future.wait(all.map((s) => s.dispose()));
  }

  Future<PtySession> activate({
    required String chatId,
    required PtySession Function() create,
  }) async {
    final existing = _sessions[chatId];
    if (existing != null) return existing;
    final session = create();
    attach(session);
    await session.start();
    return session;
  }

  /// The live terminal widget registers its mode-aware paste (xterm tracks
  /// whether the foreground app enabled bracketed paste); without one the
  /// session-level always-bracketed paste is used.
  void registerPasteDelegate(String chatId, void Function(String) delegate) {
    _pasteDelegates[chatId] = delegate;
  }

  void unregisterPasteDelegate(String chatId) {
    _pasteDelegates.remove(chatId);
  }

  void paste(String chatId, String text) {
    final delegate = _pasteDelegates[chatId];
    if (delegate != null) {
      delegate(text);
      return;
    }
    _sessions[chatId]?.pasteText(text);
  }

  void typeText(String chatId, String text) =>
      _sessions[chatId]?.typeText(text);

  void resize(String chatId, int rows, int cols) =>
      _sessions[chatId]?.resize(rows, cols);
}
