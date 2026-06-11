import 'dart:async';
import 'dart:convert';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/notifications/forge_chime.dart';
import 'package:pickforge/core/notifications/notification_settings.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/features/workbench/cubit/chat_attention_cubit.dart';

class _Chime extends Mock implements ForgeChime {}

class _Settings extends Mock implements NotificationSettingsRepository {}

class _Session extends Mock implements PtySession {}

void main() {
  late _Chime chime;
  late _Settings settings;
  late StreamController<List<int>> output;
  late StreamController<void> input;
  late _Session session;
  var appFocused = true;

  setUp(() {
    chime = _Chime();
    settings = _Settings();
    output = StreamController<List<int>>.broadcast();
    input = StreamController<void>.broadcast();
    session = _Session();
    appFocused = true;
    when(() => session.output).thenAnswer((_) => output.stream);
    when(() => session.input).thenAnswer((_) => input.stream);
    when(() => chime.playChatReady()).thenAnswer((_) async {});
    when(settings.load).thenAnswer(
      (_) async => NotificationSettings.defaults,
    );
  });

  tearDown(() async {
    await output.close();
    await input.close();
  });

  ChatAttentionCubit buildCubit(FakeAsync fake) {
    final epoch = DateTime(2026);
    final cubit = ChatAttentionCubit(
      chime: chime,
      settings: settings,
      appFocused: () => appFocused,
    )..clock = () => epoch.add(fake.elapsed);
    addTearDown(cubit.close);
    cubit.track(
      session: session,
      sessionId: 'chat-1--p1',
      chatId: 'chat-1',
      paneId: 'p1',
    );
    fake.flushMicrotasks();
    return cubit;
  }

  test('terminal bell raises attention and chimes', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      output.add([0x07]);
      fake.flushMicrotasks();

      expect(cubit.state.chatHasAttention('chat-1'), isTrue);
      expect(cubit.state.paneHasAttention('chat-1', 'p1'), isTrue);
      verify(() => chime.playChatReady()).called(1);
    });
  });

  test('BEL terminating an OSC title sequence is not a bell', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      output.add(utf8.encode('\x1b]0;my-shell-title\x07'));
      fake.flushMicrotasks();

      expect(cubit.state.chatHasAttention('chat-1'), isFalse);
      verifyNever(() => chime.playChatReady());
    });
  });

  test('input then a meaningful burst followed by quiet raises attention', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      // The user submits a command...
      input.add(null);
      fake.flushMicrotasks();
      // ...the agent streams 2KB over 2 seconds, then goes quiet.
      for (var i = 0; i < 4; i++) {
        output.add(List.filled(512, 0x61));
        fake
          ..flushMicrotasks()
          ..elapse(const Duration(milliseconds: 500));
      }
      fake.elapse(const Duration(seconds: 2));

      expect(cubit.state.paneHasAttention('chat-1', 'p1'), isTrue);
      verify(() => chime.playChatReady()).called(1);
    });
  });

  test('a startup burst with no input ever sent stays silent', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      // A fresh shell paints its prompt: big burst, but nobody asked for
      // work in this pane yet.
      for (var i = 0; i < 4; i++) {
        output.add(List.filled(512, 0x61));
        fake
          ..flushMicrotasks()
          ..elapse(const Duration(milliseconds: 500));
      }
      fake.elapse(const Duration(seconds: 2));

      expect(cubit.state.chatHasAttention('chat-1'), isFalse);
      verifyNever(() => chime.playChatReady());
    });
  });

  test('keystroke echo (small, short burst) does not raise attention', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      output.add(utf8.encode('ls\r\n'));
      fake
        ..flushMicrotasks()
        ..elapse(const Duration(seconds: 3));

      expect(cubit.state.chatHasAttention('chat-1'), isFalse);
      verifyNever(() => chime.playChatReady());
    });
  });

  test('the focused pane in a foreground app is never a notification', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake)..setActiveSession('chat-1--p1');

      output.add([0x07]);
      fake.flushMicrotasks();

      expect(cubit.state.chatHasAttention('chat-1'), isFalse);
      verifyNever(() => chime.playChatReady());
    });
  });

  test('the focused pane still notifies when the app is unfocused', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake)..setActiveSession('chat-1--p1');
      appFocused = false;

      output.add([0x07]);
      fake.flushMicrotasks();

      expect(cubit.state.chatHasAttention('chat-1'), isTrue);
    });
  });

  test('focusing the pane clears its indicator', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      output.add([0x07]);
      fake.flushMicrotasks();
      expect(cubit.state.chatHasAttention('chat-1'), isTrue);

      cubit.setActiveSession('chat-1--p1');

      expect(cubit.state.chatHasAttention('chat-1'), isFalse);
    });
  });

  test('idle then bell within the cooldown chimes once', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      // Idle-detected ready first...
      input.add(null);
      fake.flushMicrotasks();
      for (var i = 0; i < 4; i++) {
        output.add(List.filled(512, 0x61));
        fake
          ..flushMicrotasks()
          ..elapse(const Duration(milliseconds: 500));
      }
      fake.elapse(const Duration(seconds: 2));
      // ...then a bell right after: still one chime.
      output.add([0x07]);
      fake.flushMicrotasks();

      expect(cubit.state.paneHasAttention('chat-1', 'p1'), isTrue);
      verify(() => chime.playChatReady()).called(1);
    });
  });

  test('disabled sound setting keeps the indicator but stays silent', () {
    fakeAsync((fake) {
      when(settings.load).thenAnswer(
        (_) async => const NotificationSettings(chatReadySoundEnabled: false),
      );
      final cubit = buildCubit(fake);

      output.add([0x07]);
      fake.flushMicrotasks();

      expect(cubit.state.chatHasAttention('chat-1'), isTrue);
      verifyNever(() => chime.playChatReady());
    });
  });

  test('untrack drops the indicator (pane closed)', () {
    fakeAsync((fake) {
      final cubit = buildCubit(fake);

      output.add([0x07]);
      fake.flushMicrotasks();
      expect(cubit.state.chatHasAttention('chat-1'), isTrue);

      cubit.untrack('chat-1--p1');

      expect(cubit.state.chatHasAttention('chat-1'), isFalse);
    });
  });
}
