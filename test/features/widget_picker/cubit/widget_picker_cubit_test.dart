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
