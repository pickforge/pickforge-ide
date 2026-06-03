import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:vm_service/vm_service.dart';

class _MockVmService extends Mock implements VmService {}

class _FakeResponse extends Fake implements Response {
  _FakeResponse(this._json);

  final Map<String, dynamic> _json;

  @override
  Map<String, dynamic> get json => _json;
}

void main() {
  testWidgets('clears in-flight attach when VM disconnects', (tester) async {
    final service = _MockVmService();
    final vmCompleter = Completer<VM>();
    final doneCompleter = Completer<void>();
    when(service.getVM).thenAnswer((_) => vmCompleter.future);
    when(() => service.onDone).thenAnswer((_) => doneCompleter.future);
    when(service.dispose).thenAnswer((_) async {});

    final client = VmServiceClient.forTesting(factory: (_) async => service);

    await tester.pumpWidget(
      MaterialApp(
        home: WidgetPickerScope(
          vmClient: client,
          child: Builder(
            builder: (context) {
              try {
                context.watch<WidgetPickerCubit>();
                return const Text('connected');
              } on ProviderNotFoundException {
                return const Text('disconnected');
              }
            },
          ),
        ),
      ),
    );

    expect(find.text('disconnected'), findsOneWidget);

    await client.connect('ws://localhost/ws');
    await tester.pump();
    await client.disconnect();
    vmCompleter.complete(
      VM(isolates: [IsolateRef(id: 'isolates/1')]),
    );
    await tester.pump();

    expect(find.text('disconnected'), findsOneWidget);
    expect(find.text('connected'), findsNothing);
  });

  testWidgets('pauses picker while hidden and resumes when visible',
      (tester) async {
    final service = _MockVmService();
    final doneCompleter = Completer<void>();
    when(service.getVM).thenAnswer(
      (_) async => VM(isolates: [IsolateRef(id: 'isolates/1')]),
    );
    when(() => service.onDone).thenAnswer((_) => doneCompleter.future);
    when(service.dispose).thenAnswer((_) async {});
    when(
      () => service.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'enabled': true}));
    when(
      () => service.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'false'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'enabled': false}));
    when(
      () => service.callServiceExtension(
        'ext.flutter.inspector.getSelectedWidget',
        isolateId: 'isolates/1',
        args: {'objectGroup': 'pickforge'},
      ),
    ).thenAnswer((_) async => _FakeResponse({'result': null}));

    final client = VmServiceClient.forTesting(factory: (_) async => service);
    addTearDown(client.close);

    Widget build({required bool visible}) {
      return MaterialApp(
        home: WidgetPickerScope(
          vmClient: client,
          inspectorVisible: visible,
          child: Builder(
            builder: (context) {
              try {
                context.read<WidgetPickerCubit>();
                return BlocBuilder<WidgetPickerCubit, WidgetPickerState>(
                  builder: (context, state) {
                    return Text(
                      state.selectModeEnabled ? 'active' : 'paused',
                    );
                  },
                );
              } on ProviderNotFoundException {
                return const Text('disconnected');
              }
            },
          ),
        ),
      );
    }

    await tester.pumpWidget(build(visible: false));
    await client.connect('ws://localhost/ws');
    await tester.pump(const Duration(milliseconds: 100));
    verifyNever(
      () => service.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    );

    await tester.pumpWidget(build(visible: true));
    await _pumpUntilText(tester, 'active');

    expect(find.text('active'), findsOneWidget);
    verify(
      () => service.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'true'},
      ),
    ).called(1);

    await tester.pumpWidget(build(visible: false));
    await tester.pump(const Duration(milliseconds: 100));

    verify(
      () => service.callServiceExtension(
        'ext.flutter.inspector.show',
        isolateId: 'isolates/1',
        args: {'enabled': 'false'},
      ),
    ).called(1);
  });
}

Future<void> _pumpUntilText(WidgetTester tester, String text) async {
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 10));
    if (find.text(text).evaluate().isNotEmpty) return;
  }
}
