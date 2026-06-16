/// A live running instance of a target.
///
/// Minimal by design: launch and reload live behind capability-gated adapter
/// methods introduced once there is a concrete implementer.
abstract class TargetSession {
  String get targetId;

  bool get isRunning;

  Future<void> stop();
}
