// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'emulator_session_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$EmulatorSessionState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is EmulatorSessionState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'EmulatorSessionState()';
  }
}

/// @nodoc
class $EmulatorSessionStateCopyWith<$Res> {
  $EmulatorSessionStateCopyWith(
      EmulatorSessionState _, $Res Function(EmulatorSessionState) __);
}

/// Adds pattern-matching-related methods to [EmulatorSessionState].
extension EmulatorSessionStatePatterns on EmulatorSessionState {
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
    TResult Function(NoDevicePicked value)? noDevicePicked,
    TResult Function(Cold value)? cold,
    TResult Function(Booting value)? booting,
    TResult Function(Idle value)? idle,
    TResult Function(Running value)? running,
    TResult Function(Reconnecting value)? reconnecting,
    TResult Function(EmulatorError value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case NoDevicePicked() when noDevicePicked != null:
        return noDevicePicked(_that);
      case Cold() when cold != null:
        return cold(_that);
      case Booting() when booting != null:
        return booting(_that);
      case Idle() when idle != null:
        return idle(_that);
      case Running() when running != null:
        return running(_that);
      case Reconnecting() when reconnecting != null:
        return reconnecting(_that);
      case EmulatorError() when error != null:
        return error(_that);
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
    required TResult Function(NoDevicePicked value) noDevicePicked,
    required TResult Function(Cold value) cold,
    required TResult Function(Booting value) booting,
    required TResult Function(Idle value) idle,
    required TResult Function(Running value) running,
    required TResult Function(Reconnecting value) reconnecting,
    required TResult Function(EmulatorError value) error,
  }) {
    final _that = this;
    switch (_that) {
      case NoDevicePicked():
        return noDevicePicked(_that);
      case Cold():
        return cold(_that);
      case Booting():
        return booting(_that);
      case Idle():
        return idle(_that);
      case Running():
        return running(_that);
      case Reconnecting():
        return reconnecting(_that);
      case EmulatorError():
        return error(_that);
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
    TResult? Function(NoDevicePicked value)? noDevicePicked,
    TResult? Function(Cold value)? cold,
    TResult? Function(Booting value)? booting,
    TResult? Function(Idle value)? idle,
    TResult? Function(Running value)? running,
    TResult? Function(Reconnecting value)? reconnecting,
    TResult? Function(EmulatorError value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case NoDevicePicked() when noDevicePicked != null:
        return noDevicePicked(_that);
      case Cold() when cold != null:
        return cold(_that);
      case Booting() when booting != null:
        return booting(_that);
      case Idle() when idle != null:
        return idle(_that);
      case Running() when running != null:
        return running(_that);
      case Reconnecting() when reconnecting != null:
        return reconnecting(_that);
      case EmulatorError() when error != null:
        return error(_that);
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
    TResult Function()? noDevicePicked,
    TResult Function(Avd avd)? cold,
    TResult Function(Avd avd, int elapsedMs)? booting,
    TResult Function(Avd avd, String serial)? idle,
    TResult Function(String vmServiceUri, RunStats stats, Avd? avd,
            String? serial, String? appId, bool manual, DateTime? lastReloadAt)?
        running,
    TResult Function(Avd avd, String serial, String appId, int attempt)?
        reconnecting,
    TResult Function(
            String message, Avd? avd, String? serial, String? lastVmServiceUri)?
        error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case NoDevicePicked() when noDevicePicked != null:
        return noDevicePicked();
      case Cold() when cold != null:
        return cold(_that.avd);
      case Booting() when booting != null:
        return booting(_that.avd, _that.elapsedMs);
      case Idle() when idle != null:
        return idle(_that.avd, _that.serial);
      case Running() when running != null:
        return running(_that.vmServiceUri, _that.stats, _that.avd, _that.serial,
            _that.appId, _that.manual, _that.lastReloadAt);
      case Reconnecting() when reconnecting != null:
        return reconnecting(
            _that.avd, _that.serial, _that.appId, _that.attempt);
      case EmulatorError() when error != null:
        return error(
            _that.message, _that.avd, _that.serial, _that.lastVmServiceUri);
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
    required TResult Function() noDevicePicked,
    required TResult Function(Avd avd) cold,
    required TResult Function(Avd avd, int elapsedMs) booting,
    required TResult Function(Avd avd, String serial) idle,
    required TResult Function(String vmServiceUri, RunStats stats, Avd? avd,
            String? serial, String? appId, bool manual, DateTime? lastReloadAt)
        running,
    required TResult Function(Avd avd, String serial, String appId, int attempt)
        reconnecting,
    required TResult Function(
            String message, Avd? avd, String? serial, String? lastVmServiceUri)
        error,
  }) {
    final _that = this;
    switch (_that) {
      case NoDevicePicked():
        return noDevicePicked();
      case Cold():
        return cold(_that.avd);
      case Booting():
        return booting(_that.avd, _that.elapsedMs);
      case Idle():
        return idle(_that.avd, _that.serial);
      case Running():
        return running(_that.vmServiceUri, _that.stats, _that.avd, _that.serial,
            _that.appId, _that.manual, _that.lastReloadAt);
      case Reconnecting():
        return reconnecting(
            _that.avd, _that.serial, _that.appId, _that.attempt);
      case EmulatorError():
        return error(
            _that.message, _that.avd, _that.serial, _that.lastVmServiceUri);
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
    TResult? Function()? noDevicePicked,
    TResult? Function(Avd avd)? cold,
    TResult? Function(Avd avd, int elapsedMs)? booting,
    TResult? Function(Avd avd, String serial)? idle,
    TResult? Function(String vmServiceUri, RunStats stats, Avd? avd,
            String? serial, String? appId, bool manual, DateTime? lastReloadAt)?
        running,
    TResult? Function(Avd avd, String serial, String appId, int attempt)?
        reconnecting,
    TResult? Function(
            String message, Avd? avd, String? serial, String? lastVmServiceUri)?
        error,
  }) {
    final _that = this;
    switch (_that) {
      case NoDevicePicked() when noDevicePicked != null:
        return noDevicePicked();
      case Cold() when cold != null:
        return cold(_that.avd);
      case Booting() when booting != null:
        return booting(_that.avd, _that.elapsedMs);
      case Idle() when idle != null:
        return idle(_that.avd, _that.serial);
      case Running() when running != null:
        return running(_that.vmServiceUri, _that.stats, _that.avd, _that.serial,
            _that.appId, _that.manual, _that.lastReloadAt);
      case Reconnecting() when reconnecting != null:
        return reconnecting(
            _that.avd, _that.serial, _that.appId, _that.attempt);
      case EmulatorError() when error != null:
        return error(
            _that.message, _that.avd, _that.serial, _that.lastVmServiceUri);
      case _:
        return null;
    }
  }
}

/// @nodoc

class NoDevicePicked implements EmulatorSessionState {
  const NoDevicePicked();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is NoDevicePicked);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'EmulatorSessionState.noDevicePicked()';
  }
}

/// @nodoc

class Cold implements EmulatorSessionState {
  const Cold({required this.avd});

  final Avd avd;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ColdCopyWith<Cold> get copyWith =>
      _$ColdCopyWithImpl<Cold>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Cold &&
            (identical(other.avd, avd) || other.avd == avd));
  }

  @override
  int get hashCode => Object.hash(runtimeType, avd);

  @override
  String toString() {
    return 'EmulatorSessionState.cold(avd: $avd)';
  }
}

/// @nodoc
abstract mixin class $ColdCopyWith<$Res>
    implements $EmulatorSessionStateCopyWith<$Res> {
  factory $ColdCopyWith(Cold value, $Res Function(Cold) _then) =
      _$ColdCopyWithImpl;
  @useResult
  $Res call({Avd avd});
}

/// @nodoc
class _$ColdCopyWithImpl<$Res> implements $ColdCopyWith<$Res> {
  _$ColdCopyWithImpl(this._self, this._then);

  final Cold _self;
  final $Res Function(Cold) _then;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? avd = null,
  }) {
    return _then(Cold(
      avd: null == avd
          ? _self.avd
          : avd // ignore: cast_nullable_to_non_nullable
              as Avd,
    ));
  }
}

/// @nodoc

class Booting implements EmulatorSessionState {
  const Booting({required this.avd, this.elapsedMs = 0});

  final Avd avd;
  @JsonKey()
  final int elapsedMs;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $BootingCopyWith<Booting> get copyWith =>
      _$BootingCopyWithImpl<Booting>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Booting &&
            (identical(other.avd, avd) || other.avd == avd) &&
            (identical(other.elapsedMs, elapsedMs) ||
                other.elapsedMs == elapsedMs));
  }

  @override
  int get hashCode => Object.hash(runtimeType, avd, elapsedMs);

  @override
  String toString() {
    return 'EmulatorSessionState.booting(avd: $avd, elapsedMs: $elapsedMs)';
  }
}

/// @nodoc
abstract mixin class $BootingCopyWith<$Res>
    implements $EmulatorSessionStateCopyWith<$Res> {
  factory $BootingCopyWith(Booting value, $Res Function(Booting) _then) =
      _$BootingCopyWithImpl;
  @useResult
  $Res call({Avd avd, int elapsedMs});
}

/// @nodoc
class _$BootingCopyWithImpl<$Res> implements $BootingCopyWith<$Res> {
  _$BootingCopyWithImpl(this._self, this._then);

  final Booting _self;
  final $Res Function(Booting) _then;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? avd = null,
    Object? elapsedMs = null,
  }) {
    return _then(Booting(
      avd: null == avd
          ? _self.avd
          : avd // ignore: cast_nullable_to_non_nullable
              as Avd,
      elapsedMs: null == elapsedMs
          ? _self.elapsedMs
          : elapsedMs // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class Idle implements EmulatorSessionState {
  const Idle({required this.avd, required this.serial});

  final Avd avd;
  final String serial;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $IdleCopyWith<Idle> get copyWith =>
      _$IdleCopyWithImpl<Idle>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Idle &&
            (identical(other.avd, avd) || other.avd == avd) &&
            (identical(other.serial, serial) || other.serial == serial));
  }

  @override
  int get hashCode => Object.hash(runtimeType, avd, serial);

  @override
  String toString() {
    return 'EmulatorSessionState.idle(avd: $avd, serial: $serial)';
  }
}

/// @nodoc
abstract mixin class $IdleCopyWith<$Res>
    implements $EmulatorSessionStateCopyWith<$Res> {
  factory $IdleCopyWith(Idle value, $Res Function(Idle) _then) =
      _$IdleCopyWithImpl;
  @useResult
  $Res call({Avd avd, String serial});
}

/// @nodoc
class _$IdleCopyWithImpl<$Res> implements $IdleCopyWith<$Res> {
  _$IdleCopyWithImpl(this._self, this._then);

  final Idle _self;
  final $Res Function(Idle) _then;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? avd = null,
    Object? serial = null,
  }) {
    return _then(Idle(
      avd: null == avd
          ? _self.avd
          : avd // ignore: cast_nullable_to_non_nullable
              as Avd,
      serial: null == serial
          ? _self.serial
          : serial // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class Running implements EmulatorSessionState {
  Running(
      {required this.vmServiceUri,
      required this.stats,
      this.avd,
      this.serial,
      this.appId,
      this.manual = false,
      this.lastReloadAt});

  final String vmServiceUri;
  final RunStats stats;
  final Avd? avd;
  final String? serial;
  final String? appId;
  @JsonKey()
  final bool manual;
  final DateTime? lastReloadAt;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $RunningCopyWith<Running> get copyWith =>
      _$RunningCopyWithImpl<Running>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Running &&
            (identical(other.vmServiceUri, vmServiceUri) ||
                other.vmServiceUri == vmServiceUri) &&
            (identical(other.stats, stats) || other.stats == stats) &&
            (identical(other.avd, avd) || other.avd == avd) &&
            (identical(other.serial, serial) || other.serial == serial) &&
            (identical(other.appId, appId) || other.appId == appId) &&
            (identical(other.manual, manual) || other.manual == manual) &&
            (identical(other.lastReloadAt, lastReloadAt) ||
                other.lastReloadAt == lastReloadAt));
  }

  @override
  int get hashCode => Object.hash(runtimeType, vmServiceUri, stats, avd, serial,
      appId, manual, lastReloadAt);

  @override
  String toString() {
    return 'EmulatorSessionState.running(vmServiceUri: $vmServiceUri, stats: $stats, avd: $avd, serial: $serial, appId: $appId, manual: $manual, lastReloadAt: $lastReloadAt)';
  }
}

/// @nodoc
abstract mixin class $RunningCopyWith<$Res>
    implements $EmulatorSessionStateCopyWith<$Res> {
  factory $RunningCopyWith(Running value, $Res Function(Running) _then) =
      _$RunningCopyWithImpl;
  @useResult
  $Res call(
      {String vmServiceUri,
      RunStats stats,
      Avd? avd,
      String? serial,
      String? appId,
      bool manual,
      DateTime? lastReloadAt});
}

/// @nodoc
class _$RunningCopyWithImpl<$Res> implements $RunningCopyWith<$Res> {
  _$RunningCopyWithImpl(this._self, this._then);

  final Running _self;
  final $Res Function(Running) _then;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? vmServiceUri = null,
    Object? stats = null,
    Object? avd = freezed,
    Object? serial = freezed,
    Object? appId = freezed,
    Object? manual = null,
    Object? lastReloadAt = freezed,
  }) {
    return _then(Running(
      vmServiceUri: null == vmServiceUri
          ? _self.vmServiceUri
          : vmServiceUri // ignore: cast_nullable_to_non_nullable
              as String,
      stats: null == stats
          ? _self.stats
          : stats // ignore: cast_nullable_to_non_nullable
              as RunStats,
      avd: freezed == avd
          ? _self.avd
          : avd // ignore: cast_nullable_to_non_nullable
              as Avd?,
      serial: freezed == serial
          ? _self.serial
          : serial // ignore: cast_nullable_to_non_nullable
              as String?,
      appId: freezed == appId
          ? _self.appId
          : appId // ignore: cast_nullable_to_non_nullable
              as String?,
      manual: null == manual
          ? _self.manual
          : manual // ignore: cast_nullable_to_non_nullable
              as bool,
      lastReloadAt: freezed == lastReloadAt
          ? _self.lastReloadAt
          : lastReloadAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
    ));
  }
}

/// @nodoc

class Reconnecting implements EmulatorSessionState {
  const Reconnecting(
      {required this.avd,
      required this.serial,
      required this.appId,
      this.attempt = 1});

  final Avd avd;
  final String serial;
  final String appId;
  @JsonKey()
  final int attempt;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ReconnectingCopyWith<Reconnecting> get copyWith =>
      _$ReconnectingCopyWithImpl<Reconnecting>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Reconnecting &&
            (identical(other.avd, avd) || other.avd == avd) &&
            (identical(other.serial, serial) || other.serial == serial) &&
            (identical(other.appId, appId) || other.appId == appId) &&
            (identical(other.attempt, attempt) || other.attempt == attempt));
  }

  @override
  int get hashCode => Object.hash(runtimeType, avd, serial, appId, attempt);

  @override
  String toString() {
    return 'EmulatorSessionState.reconnecting(avd: $avd, serial: $serial, appId: $appId, attempt: $attempt)';
  }
}

/// @nodoc
abstract mixin class $ReconnectingCopyWith<$Res>
    implements $EmulatorSessionStateCopyWith<$Res> {
  factory $ReconnectingCopyWith(
          Reconnecting value, $Res Function(Reconnecting) _then) =
      _$ReconnectingCopyWithImpl;
  @useResult
  $Res call({Avd avd, String serial, String appId, int attempt});
}

/// @nodoc
class _$ReconnectingCopyWithImpl<$Res> implements $ReconnectingCopyWith<$Res> {
  _$ReconnectingCopyWithImpl(this._self, this._then);

  final Reconnecting _self;
  final $Res Function(Reconnecting) _then;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? avd = null,
    Object? serial = null,
    Object? appId = null,
    Object? attempt = null,
  }) {
    return _then(Reconnecting(
      avd: null == avd
          ? _self.avd
          : avd // ignore: cast_nullable_to_non_nullable
              as Avd,
      serial: null == serial
          ? _self.serial
          : serial // ignore: cast_nullable_to_non_nullable
              as String,
      appId: null == appId
          ? _self.appId
          : appId // ignore: cast_nullable_to_non_nullable
              as String,
      attempt: null == attempt
          ? _self.attempt
          : attempt // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class EmulatorError implements EmulatorSessionState {
  const EmulatorError(
      {required this.message, this.avd, this.serial, this.lastVmServiceUri});

  final String message;
  final Avd? avd;
  final String? serial;
  final String? lastVmServiceUri;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $EmulatorErrorCopyWith<EmulatorError> get copyWith =>
      _$EmulatorErrorCopyWithImpl<EmulatorError>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is EmulatorError &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.avd, avd) || other.avd == avd) &&
            (identical(other.serial, serial) || other.serial == serial) &&
            (identical(other.lastVmServiceUri, lastVmServiceUri) ||
                other.lastVmServiceUri == lastVmServiceUri));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, message, avd, serial, lastVmServiceUri);

  @override
  String toString() {
    return 'EmulatorSessionState.error(message: $message, avd: $avd, serial: $serial, lastVmServiceUri: $lastVmServiceUri)';
  }
}

/// @nodoc
abstract mixin class $EmulatorErrorCopyWith<$Res>
    implements $EmulatorSessionStateCopyWith<$Res> {
  factory $EmulatorErrorCopyWith(
          EmulatorError value, $Res Function(EmulatorError) _then) =
      _$EmulatorErrorCopyWithImpl;
  @useResult
  $Res call(
      {String message, Avd? avd, String? serial, String? lastVmServiceUri});
}

/// @nodoc
class _$EmulatorErrorCopyWithImpl<$Res>
    implements $EmulatorErrorCopyWith<$Res> {
  _$EmulatorErrorCopyWithImpl(this._self, this._then);

  final EmulatorError _self;
  final $Res Function(EmulatorError) _then;

  /// Create a copy of EmulatorSessionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
    Object? avd = freezed,
    Object? serial = freezed,
    Object? lastVmServiceUri = freezed,
  }) {
    return _then(EmulatorError(
      message: null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
      avd: freezed == avd
          ? _self.avd
          : avd // ignore: cast_nullable_to_non_nullable
              as Avd?,
      serial: freezed == serial
          ? _self.serial
          : serial // ignore: cast_nullable_to_non_nullable
              as String?,
      lastVmServiceUri: freezed == lastVmServiceUri
          ? _self.lastVmServiceUri
          : lastVmServiceUri // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

// dart format on
