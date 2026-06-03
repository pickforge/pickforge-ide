import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/selection_stream.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';

class _MockRepo extends Mock implements InspectorRepository {}

class _MockStream extends Mock implements SelectionStream {}

class _FakeSelectedWidget extends Fake implements SelectedWidget {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeSelectedWidget());
  });

  late _MockRepo repo;
  late _MockStream stream;

  setUp(() {
    repo = _MockRepo();
    stream = _MockStream();
    when(repo.enableSelectMode).thenAnswer((_) async {});
    when(repo.disableSelectMode).thenAnswer((_) async {});
  });

  group('WidgetPickerCubit', () {
    blocTest<WidgetPickerCubit, WidgetPickerState>(
      'startListening enables select mode and emits selectModeEnabled=true',
      build: () {
        when(() => stream.poll()).thenAnswer((_) => const Stream.empty());
        return WidgetPickerCubit(repo, stream);
      },
      act: (cubit) => cubit.startListening(),
      verify: (_) {
        verify(repo.enableSelectMode).called(1);
      },
      expect: () => [
        const WidgetPickerState(selectModeEnabled: true, selection: null),
      ],
    );

    blocTest<WidgetPickerCubit, WidgetPickerState>(
      'close cancels subscription and disables select mode',
      build: () {
        when(() => stream.poll()).thenAnswer((_) => const Stream.empty());
        return WidgetPickerCubit(repo, stream);
      },
      act: (cubit) async {
        await cubit.startListening();
        await cubit.close();
      },
      verify: (_) {
        verify(repo.disableSelectMode).called(greaterThanOrEqualTo(1));
      },
    );

    blocTest<WidgetPickerCubit, WidgetPickerState>(
      'pauseListening cancels polling and disables select mode',
      build: () {
        when(() => stream.poll()).thenAnswer((_) => const Stream.empty());
        return WidgetPickerCubit(repo, stream);
      },
      act: (cubit) async {
        await cubit.startListening();
        await cubit.pauseListening();
      },
      expect: () => [
        const WidgetPickerState(selectModeEnabled: true, selection: null),
        const WidgetPickerState(selectModeEnabled: false, selection: null),
      ],
      verify: (_) => verify(repo.disableSelectMode).called(1),
    );

    test('pause while enabling prevents polling after enable completes',
        () async {
      final enableCompleter = Completer<void>();
      when(repo.enableSelectMode).thenAnswer((_) => enableCompleter.future);
      when(() => stream.poll()).thenAnswer((_) => const Stream.empty());

      final cubit = WidgetPickerCubit(repo, stream);
      addTearDown(cubit.close);

      final startFuture = cubit.startListening();
      await Future<void>.delayed(Duration.zero);
      await cubit.pauseListening();

      enableCompleter.complete();
      await startFuture;

      expect(cubit.state.selectModeEnabled, isFalse);
      verify(repo.disableSelectMode).called(1);
      verifyNever(() => stream.poll());
    });

    test('pausing polling drops fetchSelection calls to zero', () async {
      var fetchCount = 0;
      when(repo.fetchSelection).thenAnswer((_) async {
        fetchCount++;
        return null;
      });

      final cubit = WidgetPickerCubit(
        repo,
        SelectionStream(repo, interval: const Duration(milliseconds: 10)),
      );
      addTearDown(cubit.close);

      await cubit.startListening();
      await Future<void>.delayed(const Duration(milliseconds: 35));
      final activeFetches = fetchCount;

      await cubit.pauseListening();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      final pausedAt = fetchCount;
      await Future<void>.delayed(const Duration(milliseconds: 35));
      final pausedFetches = fetchCount - pausedAt;

      await cubit.startListening();
      await Future<void>.delayed(const Duration(milliseconds: 35));
      final resumedFetches = fetchCount - pausedAt - pausedFetches;

      expect(activeFetches, greaterThan(0));
      expect(pausedFetches, 0);
      expect(resumedFetches, greaterThan(0));
      await cubit.close();
    });

    blocTest<WidgetPickerCubit, WidgetPickerState>(
      'emits selection when stream yields widget',
      build: () {
        const widget = SelectedWidget(
          node: WidgetNode(
            id: 'w1',
            className: 'Text',
            children: [],
            creationLocation: null,
          ),
          ancestorClasses: ['MaterialApp', 'Scaffold'],
          sourceSnippet: null,
          screenshotPath: null,
          adbScreenshotPath: null,
          propertiesJson: {},
        );
        when(() => stream.poll()).thenAnswer((_) => Stream.value(widget));
        return WidgetPickerCubit(repo, stream);
      },
      act: (cubit) => cubit.startListening(),
      expect: () => [
        const WidgetPickerState(selectModeEnabled: true, selection: null),
        const WidgetPickerState(
          selectModeEnabled: true,
          selection: SelectedWidget(
            node: WidgetNode(
              id: 'w1',
              className: 'Text',
              children: [],
              creationLocation: null,
            ),
            ancestorClasses: ['MaterialApp', 'Scaffold'],
            sourceSnippet: null,
            screenshotPath: null,
            adbScreenshotPath: null,
            propertiesJson: {},
          ),
        ),
      ],
    );
  });
}
