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
  StreamSubscription<RebuildStats>? _rebuildSubscription;
  Future<void>? _startTask;
  bool _wantsListening = false;
  bool _rebuildTrackingEnabled = false;

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
    await _startRebuildTracking();
  }

  Future<void> pauseListening({bool emitState = true}) async {
    _wantsListening = false;
    final subscription = _subscription;
    _subscription = null;
    final cancelFuture = subscription?.cancel();
    if (cancelFuture != null) unawaited(cancelFuture);
    await _stopRebuildTracking();
    if (state.selectModeEnabled) {
      await _disableSelectMode();
      if (emitState && !isClosed) {
        emit(state.copyWith(selectModeEnabled: false));
      }
    }
  }

  Future<void> _startRebuildTracking() async {
    if (_rebuildSubscription != null) return;
    try {
      await _repo.listenToExtensionEvents();
      _rebuildSubscription = _repo.watchRebuiltWidgets().listen((stats) {
        if (!isClosed) emit(state.copyWith(latestRebuildStats: stats));
      });
      await _repo.trackRebuildDirtyWidgets(enabled: true);
      _rebuildTrackingEnabled = true;
    } on Object {
      await _rebuildSubscription?.cancel();
      _rebuildSubscription = null;
    }
  }

  Future<void> _stopRebuildTracking() async {
    final subscription = _rebuildSubscription;
    _rebuildSubscription = null;
    final cancelFuture = subscription?.cancel();
    if (cancelFuture != null) unawaited(cancelFuture);
    if (!_rebuildTrackingEnabled) return;
    _rebuildTrackingEnabled = false;
    try {
      await _repo.trackRebuildDirtyWidgets(enabled: false);
    } on Object {
      return;
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
