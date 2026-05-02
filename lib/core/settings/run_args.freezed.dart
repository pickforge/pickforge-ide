// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'run_args.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$RunArgs {
  String? get targetFile;
  List<String> get extraArgs;

  /// Create a copy of RunArgs
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $RunArgsCopyWith<RunArgs> get copyWith =>
      _$RunArgsCopyWithImpl<RunArgs>(this as RunArgs, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is RunArgs &&
            (identical(other.targetFile, targetFile) ||
                other.targetFile == targetFile) &&
            const DeepCollectionEquality().equals(other.extraArgs, extraArgs));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, targetFile, const DeepCollectionEquality().hash(extraArgs));

  @override
  String toString() {
    return 'RunArgs(targetFile: $targetFile, extraArgs: $extraArgs)';
  }
}

/// @nodoc
abstract mixin class $RunArgsCopyWith<$Res> {
  factory $RunArgsCopyWith(RunArgs value, $Res Function(RunArgs) _then) =
      _$RunArgsCopyWithImpl;
  @useResult
  $Res call({String? targetFile, List<String> extraArgs});
}

/// @nodoc
class _$RunArgsCopyWithImpl<$Res> implements $RunArgsCopyWith<$Res> {
  _$RunArgsCopyWithImpl(this._self, this._then);

  final RunArgs _self;
  final $Res Function(RunArgs) _then;

  /// Create a copy of RunArgs
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? targetFile = freezed,
    Object? extraArgs = null,
  }) {
    return _then(_self.copyWith(
      targetFile: freezed == targetFile
          ? _self.targetFile
          : targetFile // ignore: cast_nullable_to_non_nullable
              as String?,
      extraArgs: null == extraArgs
          ? _self.extraArgs
          : extraArgs // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }
}

/// Adds pattern-matching-related methods to [RunArgs].
extension RunArgsPatterns on RunArgs {
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
  TResult maybeMap<TResult extends Object?>(
    TResult Function(_RunArgs value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _RunArgs() when $default != null:
        return $default(_that);
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
  TResult map<TResult extends Object?>(
    TResult Function(_RunArgs value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RunArgs():
        return $default(_that);
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
  TResult? mapOrNull<TResult extends Object?>(
    TResult? Function(_RunArgs value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RunArgs() when $default != null:
        return $default(_that);
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
  TResult maybeWhen<TResult extends Object?>(
    TResult Function(String? targetFile, List<String> extraArgs)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _RunArgs() when $default != null:
        return $default(_that.targetFile, _that.extraArgs);
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
  TResult when<TResult extends Object?>(
    TResult Function(String? targetFile, List<String> extraArgs) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RunArgs():
        return $default(_that.targetFile, _that.extraArgs);
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
  TResult? whenOrNull<TResult extends Object?>(
    TResult? Function(String? targetFile, List<String> extraArgs)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RunArgs() when $default != null:
        return $default(_that.targetFile, _that.extraArgs);
      case _:
        return null;
    }
  }
}

/// @nodoc

class _RunArgs implements RunArgs {
  const _RunArgs(
      {this.targetFile, final List<String> extraArgs = const <String>[]})
      : _extraArgs = extraArgs;

  @override
  final String? targetFile;
  final List<String> _extraArgs;
  @override
  @JsonKey()
  List<String> get extraArgs {
    if (_extraArgs is EqualUnmodifiableListView) return _extraArgs;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_extraArgs);
  }

  /// Create a copy of RunArgs
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$RunArgsCopyWith<_RunArgs> get copyWith =>
      __$RunArgsCopyWithImpl<_RunArgs>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _RunArgs &&
            (identical(other.targetFile, targetFile) ||
                other.targetFile == targetFile) &&
            const DeepCollectionEquality()
                .equals(other._extraArgs, _extraArgs));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, targetFile, const DeepCollectionEquality().hash(_extraArgs));

  @override
  String toString() {
    return 'RunArgs(targetFile: $targetFile, extraArgs: $extraArgs)';
  }
}

/// @nodoc
abstract mixin class _$RunArgsCopyWith<$Res> implements $RunArgsCopyWith<$Res> {
  factory _$RunArgsCopyWith(_RunArgs value, $Res Function(_RunArgs) _then) =
      __$RunArgsCopyWithImpl;
  @override
  @useResult
  $Res call({String? targetFile, List<String> extraArgs});
}

/// @nodoc
class __$RunArgsCopyWithImpl<$Res> implements _$RunArgsCopyWith<$Res> {
  __$RunArgsCopyWithImpl(this._self, this._then);

  final _RunArgs _self;
  final $Res Function(_RunArgs) _then;

  /// Create a copy of RunArgs
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? targetFile = freezed,
    Object? extraArgs = null,
  }) {
    return _then(_RunArgs(
      targetFile: freezed == targetFile
          ? _self.targetFile
          : targetFile // ignore: cast_nullable_to_non_nullable
              as String?,
      extraArgs: null == extraArgs
          ? _self._extraArgs
          : extraArgs // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }
}

// dart format on
