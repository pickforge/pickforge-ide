class CancelledException implements Exception {
  const CancelledException();

  @override
  String toString() => 'CancelledException';
}

class CancelToken {
  bool _cancelled = false;
  final List<void Function()> _listeners = [];

  bool get isCancelled => _cancelled;

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final listener in _listeners) {
      listener();
    }
    _listeners.clear();
  }

  void onCancel(void Function() listener) {
    if (_cancelled) {
      listener();
      return;
    }
    _listeners.add(listener);
  }

  void throwIfCancelled() {
    if (_cancelled) throw const CancelledException();
  }
}
