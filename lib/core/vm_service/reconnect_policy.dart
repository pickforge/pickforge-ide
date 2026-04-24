class ExponentialBackoff {
  const ExponentialBackoff({
    this.initial = const Duration(seconds: 1),
    this.cap = const Duration(seconds: 8),
  });

  final Duration initial;
  final Duration cap;

  Duration delayFor(int attempt) {
    assert(attempt >= 1, 'attempt must be 1-indexed');
    final exp = initial * (1 << (attempt - 1));
    return exp > cap ? cap : exp;
  }
}
