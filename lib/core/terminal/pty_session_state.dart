import 'package:equatable/equatable.dart';

sealed class PtySessionState extends Equatable {
  const PtySessionState();

  @override
  List<Object?> get props => [];
}

class PtyParked extends PtySessionState {
  const PtyParked();
}

class PtySpawning extends PtySessionState {
  const PtySpawning();
}

class PtyRunning extends PtySessionState {
  const PtyRunning();
}

class PtyExited extends PtySessionState {
  const PtyExited(this.code);

  final int code;

  @override
  List<Object?> get props => [code];
}

enum PtyFailReason { binaryNotFound, spawnTimeout, unknown }

class PtyFailed extends PtySessionState {
  const PtyFailed(this.reason, this.message);

  final PtyFailReason reason;
  final String message;

  @override
  List<Object?> get props => [reason, message];
}
