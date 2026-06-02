import 'dart:async';

import 'package:bloc/bloc.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/selection_stream.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_state.dart';

class WidgetPickerCubit extends Cubit<WidgetPickerState> {
  WidgetPickerCubit(this._repo, this._stream)
      : super(WidgetPickerState.initial());

  final InspectorRepository _repo;
  final SelectionStream _stream;
  StreamSubscription<SelectedWidget?>? _subscription;

  Future<void> startListening() async {
    await _repo.enableSelectMode();
    emit(state.copyWith(selectModeEnabled: true));
    _subscription = _stream.poll().listen(
          (selected) => emit(state.copyWith(selection: selected)),
        );
  }

  @override
  Future<void> close() async {
    await _subscription?.cancel();
    try {
      await _repo.disableSelectMode();
    } on Object {
      // The VM service may already be gone while the picker is being disposed.
    }
    return super.close();
  }
}
