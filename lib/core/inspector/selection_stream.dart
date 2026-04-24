import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';

/// Polls [InspectorRepository] for the current selection and emits
/// [SelectedWidget] only when the widget id changes.
class SelectionStream {
  SelectionStream(this._repo);

  final InspectorRepository _repo;

  Stream<SelectedWidget?> poll({
    Duration interval = const Duration(milliseconds: 500),
  }) async* {
    SelectedWidget? previous;
    while (true) {
      try {
        final current = await _repo.fetchSelection();
        final currentId = current?.node.id;
        final previousId = previous?.node.id;
        if (currentId != previousId) {
          previous = current;
          yield current;
        }
      } on Object {
        // Swallow errors — stream keeps running.
      }
      await Future<void>.delayed(interval);
    }
  }
}
