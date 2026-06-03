import 'dart:async';

import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';

/// Polls [InspectorRepository] for the current selection and emits
/// [SelectedWidget] only when the widget id changes.
class SelectionStream {
  SelectionStream(
    this._repo, {
    Duration interval = const Duration(milliseconds: 500),
  }) : _interval = interval;

  final InspectorRepository _repo;
  final Duration _interval;

  Stream<SelectedWidget?> poll({Duration? interval}) {
    final pollInterval = interval ?? _interval;
    SelectedWidget? previous;
    var hasPrevious = false;
    var polling = false;
    Timer? timer;
    late final StreamController<SelectedWidget?> controller;

    Future<void> tick() async {
      if (polling || controller.isClosed) return;
      polling = true;
      try {
        final current = await _repo.fetchSelection();
        if (controller.isClosed) return;
        final currentId = current?.node.id;
        final previousId = previous?.node.id;
        if (!hasPrevious || currentId != previousId) {
          hasPrevious = true;
          previous = current;
          controller.add(current);
        }
      } on Object {
        return;
      } finally {
        polling = false;
      }
    }

    controller = StreamController<SelectedWidget?>(
      onListen: () {
        unawaited(tick());
        timer = Timer.periodic(pollInterval, (_) => unawaited(tick()));
      },
      onCancel: () {
        timer?.cancel();
      },
    );
    return controller.stream;
  }
}
