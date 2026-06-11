import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';

class _Fake extends Mock implements PtySession {
  _Fake(this.chatId);

  @override
  final String chatId;

  bool stopped = false;
  bool started = false;

  @override
  Future<void> stop({
    Duration grace = const Duration(milliseconds: 300),
  }) async {
    stopped = true;
  }

  @override
  Future<void> dispose() async => stopped = true;

  @override
  Future<void> start() async {
    started = true;
  }
}

void main() {
  test('parkAll stops every session and clears the pool', () async {
    final pool = PtySessionPool();
    final a = _Fake('a');
    final b = _Fake('b');
    pool
      ..attach(a)
      ..attach(b);

    await pool.parkAll();

    expect(a.stopped, isTrue);
    expect(b.stopped, isTrue);
    expect(pool.session('a'), isNull);
    expect(pool.session('b'), isNull);
  });

  test('paste falls back to bracketed session paste without a delegate', () {
    final pool = PtySessionPool();
    final s = _Fake('a');
    when(() => s.pasteText(any())).thenReturn(null);
    pool
      ..attach(s)
      ..paste('a', 'hello');

    verify(() => s.pasteText('hello')).called(1);
  });

  test('paste prefers a registered delegate over raw session writes', () {
    final pool = PtySessionPool();
    final s = _Fake('a');
    final delegated = <String>[];
    pool
      ..attach(s)
      ..registerPasteDelegate('a', delegated.add)
      ..paste('a', 'hello');

    expect(delegated, ['hello']);
    verifyNever(() => s.pasteText(any()));
  });

  test('paste uses the session again after the delegate unregisters', () {
    final pool = PtySessionPool();
    final s = _Fake('a');
    when(() => s.pasteText(any())).thenReturn(null);
    pool
      ..attach(s)
      ..registerPasteDelegate('a', (_) => fail('unregistered delegate ran'))
      ..unregisterPasteDelegate('a')
      ..paste('a', 'hello');

    verify(() => s.pasteText('hello')).called(1);
  });

  test('typeText forwards to the named session', () {
    final pool = PtySessionPool();
    final s = _Fake('a');
    when(() => s.typeText(any())).thenReturn(null);
    pool
      ..attach(s)
      ..typeText('a', 'claude');

    verify(() => s.typeText('claude')).called(1);
  });

  test('activate returns existing session without spawning a duplicate',
      () async {
    final pool = PtySessionPool();
    final existing = _Fake('a');
    pool.attach(existing);

    final result = await pool.activate(
      chatId: 'a',
      create: () => throw StateError('must not spawn'),
    );

    expect(result, same(existing));
    expect(existing.started, isFalse);
  });

  test('activate creates, attaches, starts, and returns new session', () async {
    final pool = PtySessionPool();
    final created = _Fake('b');

    final result = await pool.activate(chatId: 'b', create: () => created);

    expect(result, same(created));
    expect(pool.session('b'), same(created));
    expect(created.started, isTrue);
  });

  test('activate awaits an async create (session-owned resources open first)',
      () async {
    final pool = PtySessionPool();
    final created = _Fake('c');

    final result = await pool.activate(
      chatId: 'c',
      create: () async {
        await Future<void>.delayed(Duration.zero);
        return created;
      },
    );

    expect(result, same(created));
    expect(created.started, isTrue);
  });
}
