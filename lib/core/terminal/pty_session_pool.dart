import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/pty_session.dart';

@lazySingleton
class PtySessionPool {
  final _sessions = <String, PtySession>{};

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

  void sendPrompt(String chatId, String prompt) {
    final s = _sessions[chatId];
    if (s == null) return;
    s.write('$prompt\r'.codeUnits);
  }

  void resize(String chatId, int rows, int cols) =>
      _sessions[chatId]?.resize(rows, cols);
}
