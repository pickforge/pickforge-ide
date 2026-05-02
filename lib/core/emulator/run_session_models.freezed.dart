// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'run_session_models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$RunSessionEvent {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is RunSessionEvent);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'RunSessionEvent()';
  }
}

/// @nodoc
class $RunSessionEventCopyWith<$Res> {
  $RunSessionEventCopyWith(
      RunSessionEvent _, $Res Function(RunSessionEvent) __);
}

/// Adds pattern-matching-related methods to [RunSessionEvent].
extension RunSessionEventPatterns on RunSessionEvent {
  /// A variant of `map` that fallback to returning `orElse`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(_Stage value)? stage,
    TResult Function(_Log value)? log,
    TResult Function(_VmReady value)? vmServiceReady,
    TResult Function(_Stopped value)? stopped,
    TResult Function(_ReloadCompleted value)? reloadCompleted,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _Stage() when stage != null:
        return stage(_that);
      case _Log() when log != null:
        return log(_that);
      case _VmReady() when vmServiceReady != null:
        return vmServiceReady(_that);
      case _Stopped() when stopped != null:
        return stopped(_that);
      case _ReloadCompleted() when reloadCompleted != null:
        return reloadCompleted(_that);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// Callbacks receives the raw object, upcasted.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case final Subclass2 value:
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(_Stage value) stage,
    required TResult Function(_Log value) log,
    required TResult Function(_VmReady value) vmServiceReady,
    required TResult Function(_Stopped value) stopped,
    required TResult Function(_ReloadCompleted value) reloadCompleted,
  }) {
    final _that = this;
    switch (_that) {
      case _Stage():
        return stage(_that);
      case _Log():
        return log(_that);
      case _VmReady():
        return vmServiceReady(_that);
      case _Stopped():
        return stopped(_that);
      case _ReloadCompleted():
        return reloadCompleted(_that);
      case _:
        throw StateError('Unexpected subclass');
    }
  }

  /// A variant of `map` that fallback to returning `null`.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case final Subclass value:
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(_Stage value)? stage,
    TResult? Function(_Log value)? log,
    TResult? Function(_VmReady value)? vmServiceReady,
    TResult? Function(_Stopped value)? stopped,
    TResult? Function(_ReloadCompleted value)? reloadCompleted,
  }) {
    final _that = this;
    switch (_that) {
      case _Stage() when stage != null:
        return stage(_that);
      case _Log() when log != null:
        return log(_that);
      case _VmReady() when vmServiceReady != null:
        return vmServiceReady(_that);
      case _Stopped() when stopped != null:
        return stopped(_that);
      case _ReloadCompleted() when reloadCompleted != null:
        return reloadCompleted(_that);
      case _:
        return null;
    }
  }

  /// A variant of `when` that fallback to an `orElse` callback.
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return orElse();
  /// }
  /// ```

  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String message)? stage,
    TResult Function(String line, LogLevel level, String source)? log,
    TResult Function(String uri)? vmServiceReady,
    TResult Function(int exitCode, String reason)? stopped,
    TResult Function(bool success, bool fullRestart, int durationMs,
            String attribution, String? hint)?
        reloadCompleted,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _Stage() when stage != null:
        return stage(_that.message);
      case _Log() when log != null:
        return log(_that.line, _that.level, _that.source);
      case _VmReady() when vmServiceReady != null:
        return vmServiceReady(_that.uri);
      case _Stopped() when stopped != null:
        return stopped(_that.exitCode, _that.reason);
      case _ReloadCompleted() when reloadCompleted != null:
        return reloadCompleted(_that.success, _that.fullRestart,
            _that.durationMs, _that.attribution, _that.hint);
      case _:
        return orElse();
    }
  }

  /// A `switch`-like method, using callbacks.
  ///
  /// As opposed to `map`, this offers destructuring.
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case Subclass2(:final field2):
  ///     return ...;
  /// }
  /// ```

  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(String message) stage,
    required TResult Function(String line, LogLevel level, String source) log,
    required TResult Function(String uri) vmServiceReady,
    required TResult Function(int exitCode, String reason) stopped,
    required TResult Function(bool success, bool fullRestart, int durationMs,
            String attribution, String? hint)
        reloadCompleted,
  }) {
    final _that = this;
    switch (_that) {
      case _Stage():
        return stage(_that.message);
      case _Log():
        return log(_that.line, _that.level, _that.source);
      case _VmReady():
        return vmServiceReady(_that.uri);
      case _Stopped():
        return stopped(_that.exitCode, _that.reason);
      case _ReloadCompleted():
        return reloadCompleted(_that.success, _that.fullRestart,
            _that.durationMs, _that.attribution, _that.hint);
      case _:
        throw StateError('Unexpected subclass');
    }
  }

  /// A variant of `when` that fallback to returning `null`
  ///
  /// It is equivalent to doing:
  /// ```dart
  /// switch (sealedClass) {
  ///   case Subclass(:final field):
  ///     return ...;
  ///   case _:
  ///     return null;
  /// }
  /// ```

  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String message)? stage,
    TResult? Function(String line, LogLevel level, String source)? log,
    TResult? Function(String uri)? vmServiceReady,
    TResult? Function(int exitCode, String reason)? stopped,
    TResult? Function(bool success, bool fullRestart, int durationMs,
            String attribution, String? hint)?
        reloadCompleted,
  }) {
    final _that = this;
    switch (_that) {
      case _Stage() when stage != null:
        return stage(_that.message);
      case _Log() when log != null:
        return log(_that.line, _that.level, _that.source);
      case _VmReady() when vmServiceReady != null:
        return vmServiceReady(_that.uri);
      case _Stopped() when stopped != null:
        return stopped(_that.exitCode, _that.reason);
      case _ReloadCompleted() when reloadCompleted != null:
        return reloadCompleted(_that.success, _that.fullRestart,
            _that.durationMs, _that.attribution, _that.hint);
      case _:
        return null;
    }
  }
}

/// @nodoc

class _Stage implements RunSessionEvent {
  const _Stage({required this.message});

  final String message;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$StageCopyWith<_Stage> get copyWith =>
      __$StageCopyWithImpl<_Stage>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Stage &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @override
  String toString() {
    return 'RunSessionEvent.stage(message: $message)';
  }
}

/// @nodoc
abstract mixin class _$StageCopyWith<$Res>
    implements $RunSessionEventCopyWith<$Res> {
  factory _$StageCopyWith(_Stage value, $Res Function(_Stage) _then) =
      __$StageCopyWithImpl;
  @useResult
  $Res call({String message});
}

/// @nodoc
class __$StageCopyWithImpl<$Res> implements _$StageCopyWith<$Res> {
  __$StageCopyWithImpl(this._self, this._then);

  final _Stage _self;
  final $Res Function(_Stage) _then;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
  }) {
    return _then(_Stage(
      message: null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _Log implements RunSessionEvent {
  const _Log(
      {required this.line, required this.level, this.source = 'flutter'});

  final String line;
  final LogLevel level;
  @JsonKey()
  final String source;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$LogCopyWith<_Log> get copyWith =>
      __$LogCopyWithImpl<_Log>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Log &&
            (identical(other.line, line) || other.line == line) &&
            (identical(other.level, level) || other.level == level) &&
            (identical(other.source, source) || other.source == source));
  }

  @override
  int get hashCode => Object.hash(runtimeType, line, level, source);

  @override
  String toString() {
    return 'RunSessionEvent.log(line: $line, level: $level, source: $source)';
  }
}

/// @nodoc
abstract mixin class _$LogCopyWith<$Res>
    implements $RunSessionEventCopyWith<$Res> {
  factory _$LogCopyWith(_Log value, $Res Function(_Log) _then) =
      __$LogCopyWithImpl;
  @useResult
  $Res call({String line, LogLevel level, String source});
}

/// @nodoc
class __$LogCopyWithImpl<$Res> implements _$LogCopyWith<$Res> {
  __$LogCopyWithImpl(this._self, this._then);

  final _Log _self;
  final $Res Function(_Log) _then;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? line = null,
    Object? level = null,
    Object? source = null,
  }) {
    return _then(_Log(
      line: null == line
          ? _self.line
          : line // ignore: cast_nullable_to_non_nullable
              as String,
      level: null == level
          ? _self.level
          : level // ignore: cast_nullable_to_non_nullable
              as LogLevel,
      source: null == source
          ? _self.source
          : source // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _VmReady implements RunSessionEvent {
  const _VmReady({required this.uri});

  final String uri;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$VmReadyCopyWith<_VmReady> get copyWith =>
      __$VmReadyCopyWithImpl<_VmReady>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _VmReady &&
            (identical(other.uri, uri) || other.uri == uri));
  }

  @override
  int get hashCode => Object.hash(runtimeType, uri);

  @override
  String toString() {
    return 'RunSessionEvent.vmServiceReady(uri: $uri)';
  }
}

/// @nodoc
abstract mixin class _$VmReadyCopyWith<$Res>
    implements $RunSessionEventCopyWith<$Res> {
  factory _$VmReadyCopyWith(_VmReady value, $Res Function(_VmReady) _then) =
      __$VmReadyCopyWithImpl;
  @useResult
  $Res call({String uri});
}

/// @nodoc
class __$VmReadyCopyWithImpl<$Res> implements _$VmReadyCopyWith<$Res> {
  __$VmReadyCopyWithImpl(this._self, this._then);

  final _VmReady _self;
  final $Res Function(_VmReady) _then;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? uri = null,
  }) {
    return _then(_VmReady(
      uri: null == uri
          ? _self.uri
          : uri // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _Stopped implements RunSessionEvent {
  const _Stopped({required this.exitCode, required this.reason});

  final int exitCode;
  final String reason;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$StoppedCopyWith<_Stopped> get copyWith =>
      __$StoppedCopyWithImpl<_Stopped>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Stopped &&
            (identical(other.exitCode, exitCode) ||
                other.exitCode == exitCode) &&
            (identical(other.reason, reason) || other.reason == reason));
  }

  @override
  int get hashCode => Object.hash(runtimeType, exitCode, reason);

  @override
  String toString() {
    return 'RunSessionEvent.stopped(exitCode: $exitCode, reason: $reason)';
  }
}

/// @nodoc
abstract mixin class _$StoppedCopyWith<$Res>
    implements $RunSessionEventCopyWith<$Res> {
  factory _$StoppedCopyWith(_Stopped value, $Res Function(_Stopped) _then) =
      __$StoppedCopyWithImpl;
  @useResult
  $Res call({int exitCode, String reason});
}

/// @nodoc
class __$StoppedCopyWithImpl<$Res> implements _$StoppedCopyWith<$Res> {
  __$StoppedCopyWithImpl(this._self, this._then);

  final _Stopped _self;
  final $Res Function(_Stopped) _then;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? exitCode = null,
    Object? reason = null,
  }) {
    return _then(_Stopped(
      exitCode: null == exitCode
          ? _self.exitCode
          : exitCode // ignore: cast_nullable_to_non_nullable
              as int,
      reason: null == reason
          ? _self.reason
          : reason // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _ReloadCompleted implements RunSessionEvent {
  const _ReloadCompleted(
      {required this.success,
      required this.fullRestart,
      required this.durationMs,
      this.attribution = 'user',
      this.hint});

  final bool success;
  final bool fullRestart;
  final int durationMs;
  @JsonKey()
  final String attribution;
  final String? hint;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$ReloadCompletedCopyWith<_ReloadCompleted> get copyWith =>
      __$ReloadCompletedCopyWithImpl<_ReloadCompleted>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _ReloadCompleted &&
            (identical(other.success, success) || other.success == success) &&
            (identical(other.fullRestart, fullRestart) ||
                other.fullRestart == fullRestart) &&
            (identical(other.durationMs, durationMs) ||
                other.durationMs == durationMs) &&
            (identical(other.attribution, attribution) ||
                other.attribution == attribution) &&
            (identical(other.hint, hint) || other.hint == hint));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, success, fullRestart, durationMs, attribution, hint);

  @override
  String toString() {
    return 'RunSessionEvent.reloadCompleted(success: $success, fullRestart: $fullRestart, durationMs: $durationMs, attribution: $attribution, hint: $hint)';
  }
}

/// @nodoc
abstract mixin class _$ReloadCompletedCopyWith<$Res>
    implements $RunSessionEventCopyWith<$Res> {
  factory _$ReloadCompletedCopyWith(
          _ReloadCompleted value, $Res Function(_ReloadCompleted) _then) =
      __$ReloadCompletedCopyWithImpl;
  @useResult
  $Res call(
      {bool success,
      bool fullRestart,
      int durationMs,
      String attribution,
      String? hint});
}

/// @nodoc
class __$ReloadCompletedCopyWithImpl<$Res>
    implements _$ReloadCompletedCopyWith<$Res> {
  __$ReloadCompletedCopyWithImpl(this._self, this._then);

  final _ReloadCompleted _self;
  final $Res Function(_ReloadCompleted) _then;

  /// Create a copy of RunSessionEvent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? success = null,
    Object? fullRestart = null,
    Object? durationMs = null,
    Object? attribution = null,
    Object? hint = freezed,
  }) {
    return _then(_ReloadCompleted(
      success: null == success
          ? _self.success
          : success // ignore: cast_nullable_to_non_nullable
              as bool,
      fullRestart: null == fullRestart
          ? _self.fullRestart
          : fullRestart // ignore: cast_nullable_to_non_nullable
              as bool,
      durationMs: null == durationMs
          ? _self.durationMs
          : durationMs // ignore: cast_nullable_to_non_nullable
              as int,
      attribution: null == attribution
          ? _self.attribution
          : attribution // ignore: cast_nullable_to_non_nullable
              as String,
      hint: freezed == hint
          ? _self.hint
          : hint // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

// dart format on
