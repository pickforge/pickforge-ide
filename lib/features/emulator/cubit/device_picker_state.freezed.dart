// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'device_picker_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$DevicePickerState {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is DevicePickerState);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'DevicePickerState()';
  }
}

/// @nodoc
class $DevicePickerStateCopyWith<$Res> {
  $DevicePickerStateCopyWith(
      DevicePickerState _, $Res Function(DevicePickerState) __);
}

/// Adds pattern-matching-related methods to [DevicePickerState].
extension DevicePickerStatePatterns on DevicePickerState {
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
    TResult Function(Initial value)? initial,
    TResult Function(Loading value)? loading,
    TResult Function(Loaded value)? loaded,
    TResult Function(PickerError value)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case Initial() when initial != null:
        return initial(_that);
      case Loading() when loading != null:
        return loading(_that);
      case Loaded() when loaded != null:
        return loaded(_that);
      case PickerError() when error != null:
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
    required TResult Function(Initial value) initial,
    required TResult Function(Loading value) loading,
    required TResult Function(Loaded value) loaded,
    required TResult Function(PickerError value) error,
  }) {
    final _that = this;
    switch (_that) {
      case Initial():
        return initial(_that);
      case Loading():
        return loading(_that);
      case Loaded():
        return loaded(_that);
      case PickerError():
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
    TResult? Function(Initial value)? initial,
    TResult? Function(Loading value)? loading,
    TResult? Function(Loaded value)? loaded,
    TResult? Function(PickerError value)? error,
  }) {
    final _that = this;
    switch (_that) {
      case Initial() when initial != null:
        return initial(_that);
      case Loading() when loading != null:
        return loading(_that);
      case Loaded() when loaded != null:
        return loaded(_that);
      case PickerError() when error != null:
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
    TResult Function()? initial,
    TResult Function()? loading,
    TResult Function(List<Avd> avds, List<RunningAndroidDevice> running)?
        loaded,
    TResult Function(String message)? error,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case Initial() when initial != null:
        return initial();
      case Loading() when loading != null:
        return loading();
      case Loaded() when loaded != null:
        return loaded(_that.avds, _that.running);
      case PickerError() when error != null:
        return error(_that.message);
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
    required TResult Function() initial,
    required TResult Function() loading,
    required TResult Function(
            List<Avd> avds, List<RunningAndroidDevice> running)
        loaded,
    required TResult Function(String message) error,
  }) {
    final _that = this;
    switch (_that) {
      case Initial():
        return initial();
      case Loading():
        return loading();
      case Loaded():
        return loaded(_that.avds, _that.running);
      case PickerError():
        return error(_that.message);
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
    TResult? Function()? initial,
    TResult? Function()? loading,
    TResult? Function(List<Avd> avds, List<RunningAndroidDevice> running)?
        loaded,
    TResult? Function(String message)? error,
  }) {
    final _that = this;
    switch (_that) {
      case Initial() when initial != null:
        return initial();
      case Loading() when loading != null:
        return loading();
      case Loaded() when loaded != null:
        return loaded(_that.avds, _that.running);
      case PickerError() when error != null:
        return error(_that.message);
      case _:
        return null;
    }
  }
}

/// @nodoc

class Initial implements DevicePickerState {
  const Initial();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is Initial);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'DevicePickerState.initial()';
  }
}

/// @nodoc

class Loading implements DevicePickerState {
  const Loading();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is Loading);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'DevicePickerState.loading()';
  }
}

/// @nodoc

class Loaded implements DevicePickerState {
  const Loaded(
      {required final List<Avd> avds,
      required final List<RunningAndroidDevice> running})
      : _avds = avds,
        _running = running;

  final List<Avd> _avds;
  List<Avd> get avds {
    if (_avds is EqualUnmodifiableListView) return _avds;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_avds);
  }

  final List<RunningAndroidDevice> _running;
  List<RunningAndroidDevice> get running {
    if (_running is EqualUnmodifiableListView) return _running;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_running);
  }

  /// Create a copy of DevicePickerState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $LoadedCopyWith<Loaded> get copyWith =>
      _$LoadedCopyWithImpl<Loaded>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is Loaded &&
            const DeepCollectionEquality().equals(other._avds, _avds) &&
            const DeepCollectionEquality().equals(other._running, _running));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType,
      const DeepCollectionEquality().hash(_avds),
      const DeepCollectionEquality().hash(_running));

  @override
  String toString() {
    return 'DevicePickerState.loaded(avds: $avds, running: $running)';
  }
}

/// @nodoc
abstract mixin class $LoadedCopyWith<$Res>
    implements $DevicePickerStateCopyWith<$Res> {
  factory $LoadedCopyWith(Loaded value, $Res Function(Loaded) _then) =
      _$LoadedCopyWithImpl;
  @useResult
  $Res call({List<Avd> avds, List<RunningAndroidDevice> running});
}

/// @nodoc
class _$LoadedCopyWithImpl<$Res> implements $LoadedCopyWith<$Res> {
  _$LoadedCopyWithImpl(this._self, this._then);

  final Loaded _self;
  final $Res Function(Loaded) _then;

  /// Create a copy of DevicePickerState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? avds = null,
    Object? running = null,
  }) {
    return _then(Loaded(
      avds: null == avds
          ? _self._avds
          : avds // ignore: cast_nullable_to_non_nullable
              as List<Avd>,
      running: null == running
          ? _self._running
          : running // ignore: cast_nullable_to_non_nullable
              as List<RunningAndroidDevice>,
    ));
  }
}

/// @nodoc

class PickerError implements DevicePickerState {
  const PickerError(this.message);

  final String message;

  /// Create a copy of DevicePickerState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $PickerErrorCopyWith<PickerError> get copyWith =>
      _$PickerErrorCopyWithImpl<PickerError>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is PickerError &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @override
  String toString() {
    return 'DevicePickerState.error(message: $message)';
  }
}

/// @nodoc
abstract mixin class $PickerErrorCopyWith<$Res>
    implements $DevicePickerStateCopyWith<$Res> {
  factory $PickerErrorCopyWith(
          PickerError value, $Res Function(PickerError) _then) =
      _$PickerErrorCopyWithImpl;
  @useResult
  $Res call({String message});
}

/// @nodoc
class _$PickerErrorCopyWithImpl<$Res> implements $PickerErrorCopyWith<$Res> {
  _$PickerErrorCopyWithImpl(this._self, this._then);

  final PickerError _self;
  final $Res Function(PickerError) _then;

  /// Create a copy of DevicePickerState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? message = null,
  }) {
    return _then(PickerError(
      null == message
          ? _self.message
          : message // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

// dart format on
