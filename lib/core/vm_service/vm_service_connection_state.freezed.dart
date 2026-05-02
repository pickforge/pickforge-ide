// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'vm_service_connection_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$VmServiceConnectionState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is VmServiceConnectionState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'VmServiceConnectionState()';
  }
}

/// @nodoc
class $VmServiceConnectionStateCopyWith<$Res> {
  $VmServiceConnectionStateCopyWith(
      VmServiceConnectionState _, $Res Function(VmServiceConnectionState) __);
}

/// Adds pattern-matching-related methods to [VmServiceConnectionState].
extension VmServiceConnectionStatePatterns on VmServiceConnectionState {
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
    TResult Function(_Idle value)? idle,
    TResult Function(_Connecting value)? connecting,
    TResult Function(_Connected value)? connected,
    TResult Function(_Error value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _Idle() when idle != null:
        return idle(_that);
      case _Connecting() when connecting != null:
        return connecting(_that);
      case _Connected() when connected != null:
        return connected(_that);
      case _Error() when error != null:
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
    required TResult Function(_Idle value) idle,
    required TResult Function(_Connecting value) connecting,
    required TResult Function(_Connected value) connected,
    required TResult Function(_Error value) error,
  }) {
    final _that = this;
    switch (_that) {
      case _Idle():
        return idle(_that);
      case _Connecting():
        return connecting(_that);
      case _Connected():
        return connected(_that);
      case _Error():
        return error(_that);
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
    TResult? Function(_Idle value)? idle,
    TResult? Function(_Connecting value)? connecting,
    TResult? Function(_Connected value)? connected,
    TResult? Function(_Error value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case _Idle() when idle != null:
        return idle(_that);
      case _Connecting() when connecting != null:
        return connecting(_that);
      case _Connected() when connected != null:
        return connected(_that);
      case _Error() when error != null:
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
    TResult Function()? idle,
    TResult Function(int attempt)? connecting,
    TResult Function(String url)? connected,
    TResult Function(String message, int attempt)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _Idle() when idle != null:
        return idle();
      case _Connecting() when connecting != null:
        return connecting(_that.attempt);
      case _Connected() when connected != null:
        return connected(_that.url);
      case _Error() when error != null:
        return error(_that.message, _that.attempt);
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
    required TResult Function() idle,
    required TResult Function(int attempt) connecting,
    required TResult Function(String url) connected,
    required TResult Function(String message, int attempt) error,
  }) {
    final _that = this;
    switch (_that) {
      case _Idle():
        return idle();
      case _Connecting():
        return connecting(_that.attempt);
      case _Connected():
        return connected(_that.url);
      case _Error():
        return error(_that.message, _that.attempt);
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
    TResult? Function()? idle,
    TResult? Function(int attempt)? connecting,
    TResult? Function(String url)? connected,
    TResult? Function(String message, int attempt)? error,
  }) {
    final _that = this;
    switch (_that) {
      case _Idle() when idle != null:
        return idle();
      case _Connecting() when connecting != null:
        return connecting(_that.attempt);
      case _Connected() when connected != null:
        return connected(_that.url);
      case _Error() when error != null:
        return error(_that.message, _that.attempt);
      case _:
        return null;
    }
  }
}

/// @nodoc

class _Idle implements VmServiceConnectionState {
  const _Idle();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is _Idle);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'VmServiceConnectionState.idle()';
  }
}

/// @nodoc

class _Connecting implements VmServiceConnectionState {
  const _Connecting({required this.attempt});

  final int attempt;

  /// Create a copy of VmServiceConnectionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$ConnectingCopyWith<_Connecting> get copyWith =>
      __$ConnectingCopyWithImpl<_Connecting>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Connecting &&
            (identical(other.attempt, attempt) || other.attempt == attempt));
  }

  @override
  int get hashCode => Object.hash(runtimeType, attempt);

  @override
  String toString() {
    return 'VmServiceConnectionState.connecting(attempt: $attempt)';
  }
}

/// @nodoc
abstract mixin class _$ConnectingCopyWith<$Res>
    implements $VmServiceConnectionStateCopyWith<$Res> {
  factory _$ConnectingCopyWith(
          _Connecting value, $Res Function(_Connecting) _then) =
      __$ConnectingCopyWithImpl;
  @useResult
  $Res call({int attempt});
}

/// @nodoc
class __$ConnectingCopyWithImpl<$Res> implements _$ConnectingCopyWith<$Res> {
  __$ConnectingCopyWithImpl(this._self, this._then);

  final _Connecting _self;
  final $Res Function(_Connecting) _then;

  /// Create a copy of VmServiceConnectionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? attempt = null,
  }) {
    return _then(_Connecting(
      attempt: null == attempt
          ? _self.attempt
          : attempt // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// @nodoc

class _Connected implements VmServiceConnectionState {
  const _Connected({required this.url});

  final String url;

  /// Create a copy of VmServiceConnectionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$ConnectedCopyWith<_Connected> get copyWith =>
      __$ConnectedCopyWithImpl<_Connected>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Connected &&
            (identical(other.url, url) || other.url == url));
  }

  @override
  int get hashCode => Object.hash(runtimeType, url);

  @override
  String toString() {
    return 'VmServiceConnectionState.connected(url: $url)';
  }
}

/// @nodoc
abstract mixin class _$ConnectedCopyWith<$Res>
    implements $VmServiceConnectionStateCopyWith<$Res> {
  factory _$ConnectedCopyWith(
          _Connected value, $Res Function(_Connected) _then) =
      __$ConnectedCopyWithImpl;
  @useResult
  $Res call({String url});
}

/// @nodoc
class __$ConnectedCopyWithImpl<$Res> implements _$ConnectedCopyWith<$Res> {
  __$ConnectedCopyWithImpl(this._self, this._then);

  final _Connected _self;
  final $Res Function(_Connected) _then;

  /// Create a copy of VmServiceConnectionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? url = null,
  }) {
    return _then(_Connected(
      url: null == url
          ? _self.url
          : url // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class _Error implements VmServiceConnectionState {
  const _Error({required this.message, required this.attempt});

  final String message;
  final int attempt;

  /// Create a copy of VmServiceConnectionState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$ErrorCopyWith<_Error> get copyWith =>
      __$ErrorCopyWithImpl<_Error>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _Error &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.attempt, attempt) || other.attempt == attempt));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message, attempt);

  @override
  String toString() {
    return 'VmServiceConnectionState.error(message: $message, attempt: $attempt)';
  }
}

/// @nodoc
abstract mixin class _$ErrorCopyWith<$Res>
    implements $VmServiceConnectionStateCopyWith<$Res> {
  factory _$ErrorCopyWith(_Error value, $Res Function(_Error) _then) =
      __$ErrorCopyWithImpl;
  @useResult
  $Res call({String message, int attempt});
}

/// @nodoc
class __$ErrorCopyWithImpl<$Res> implements _$ErrorCopyWith<$Res> {
  __$ErrorCopyWithImpl(this._self, this._then);

  final _Error _self;
  final $Res Function(_Error) _then;

  /// Create a copy of VmServiceConnectionState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
    Object? attempt = null,
  }) {
    return _then(_Error(
      message: null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
      attempt: null == attempt
          ? _self.attempt
          : attempt // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on
