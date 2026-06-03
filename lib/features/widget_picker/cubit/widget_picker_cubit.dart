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
  // Cancellation is requested without awaiting so select mode can stop first.
  // ignore: cancel_subscriptions
  StreamSubscription<SelectedWidget?>? _subscription;
  Future<void>? _startTask;
  bool _wantsListening = false;

  Future<void> startListening() async {
    _wantsListening = true;
    if (_subscription != null) return;
    final startTask = _startTask;
    if (startTask != null) return startTask;
    final task = _startListening();
    _startTask = task;
    try {
      await task;
    } finally {
      if (identical(_startTask, task)) _startTask = null;
    }
  }

  Future<void> _startListening() async {
    await _repo.enableSelectMode();
    if (isClosed || !_wantsListening) {
      await _disableSelectMode();
      return;
    }
    emit(state.copyWith(selectModeEnabled: true));
    if (!_wantsListening) {
      await _disableSelectMode();
      if (!isClosed) emit(state.copyWith(selectModeEnabled: false));
      return;
    }
    _subscription = _stream.poll().listen(
      (selected) {
        if (!isClosed) emit(state.copyWith(selection: selected));
      },
    );
  }

  Future<void> pauseListening({bool emitState = true}) async {
    _wantsListening = false;
    final subscription = _subscription;
    _subscription = null;
    final cancelFuture = subscription?.cancel();
    if (cancelFuture != null) unawaited(cancelFuture);
    if (state.selectModeEnabled) {
      await _disableSelectMode();
      if (emitState && !isClosed) {
        emit(state.copyWith(selectModeEnabled: false));
      }
    }
  }

  Future<void> _disableSelectMode() async {
    try {
      await _repo.disableSelectMode();
    } on Object {
      if (isClosed) return;
    }
  }

  @override
  Future<void> close() async {
    await pauseListening(emitState: false);
    return super.close();
  }
}
