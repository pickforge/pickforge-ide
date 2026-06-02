import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:vm_service/vm_service.dart';

class _MockVmService extends Mock implements VmService {}

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
}
