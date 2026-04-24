import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/connection/bloc/connection_bloc.dart';
import 'package:pickforge/features/connection/bloc/connection_event.dart';
import 'package:pickforge/features/connection/bloc/connection_state.dart'
    as conn;
import 'package:pickforge/features/connection/view/connection_view.dart';

class _MockConnectionBloc
    extends MockBloc<ConnectionEvent, conn.ConnectionState>
    implements ConnectionBloc {}

void main() {
  testWidgets('renders title and URL field hint', (tester) async {
    final bloc = _MockConnectionBloc();
    when(() => bloc.state).thenReturn(const conn.ConnectionState.idle());

    await tester.pumpWidget(
      MaterialApp(home: ConnectionView(bloc: bloc)),
    );

    expect(find.text('Connect to VM Service'), findsOneWidget);
    expect(find.text('ws://127.0.0.1:PORT/UUID=/ws'), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
  });

  testWidgets('shows saved URL when idle with savedUrl', (tester) async {
    final bloc = _MockConnectionBloc();
    when(() => bloc.state).thenReturn(
      const conn.ConnectionState.idle(savedUrl: 'ws://saved/ws'),
    );

    await tester.pumpWidget(
      MaterialApp(home: ConnectionView(bloc: bloc)),
    );

    expect(find.text('Last used: ws://saved/ws'), findsOneWidget);
  });

  testWidgets('shows connected status', (tester) async {
    final bloc = _MockConnectionBloc();
    when(() => bloc.state).thenReturn(
      const conn.ConnectionState.connected(url: 'ws://live/ws'),
    );

    await tester.pumpWidget(
      MaterialApp(home: ConnectionView(bloc: bloc)),
    );

    expect(find.text('Connected: ws://live/ws'), findsOneWidget);
    expect(find.text('Disconnect'), findsOneWidget);
  });

  testWidgets('shows error message', (tester) async {
    final bloc = _MockConnectionBloc();
    when(() => bloc.state).thenReturn(
      const conn.ConnectionState.error(
        url: 'ws://bad/ws',
        message: 'Connection refused',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(home: ConnectionView(bloc: bloc)),
    );

    expect(find.text('Connection refused'), findsOneWidget);
  });

  testWidgets('disables button while connecting', (tester) async {
    final bloc = _MockConnectionBloc();
    when(() => bloc.state).thenReturn(
      const conn.ConnectionState.connecting(url: 'ws://test/ws'),
    );

    await tester.pumpWidget(
      MaterialApp(home: ConnectionView(bloc: bloc)),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
    expect(find.text('Connecting...'), findsOneWidget);
  });
}
