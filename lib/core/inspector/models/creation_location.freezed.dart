// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'creation_location.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CreationLocation {
  String get file;
  int get line;
  int get column;

  /// Create a copy of CreationLocation
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $CreationLocationCopyWith<CreationLocation> get copyWith =>
      _$CreationLocationCopyWithImpl<CreationLocation>(
          this as CreationLocation, _$identity);

  /// Serializes this CreationLocation to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is CreationLocation &&
            (identical(other.file, file) || other.file == file) &&
            (identical(other.line, line) || other.line == line) &&
            (identical(other.column, column) || other.column == column));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, file, line, column);

  @override
  String toString() {
    return 'CreationLocation(file: $file, line: $line, column: $column)';
  }
}

/// @nodoc
abstract mixin class $CreationLocationCopyWith<$Res> {
  factory $CreationLocationCopyWith(
          CreationLocation value, $Res Function(CreationLocation) _then) =
      _$CreationLocationCopyWithImpl;
  @useResult
  $Res call({String file, int line, int column});
}

/// @nodoc
class _$CreationLocationCopyWithImpl<$Res>
    implements $CreationLocationCopyWith<$Res> {
  _$CreationLocationCopyWithImpl(this._self, this._then);

  final CreationLocation _self;
  final $Res Function(CreationLocation) _then;

  /// Create a copy of CreationLocation
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? file = null,
    Object? line = null,
    Object? column = null,
  }) {
    return _then(_self.copyWith(
      file: null == file
          ? _self.file
          : file // ignore: cast_nullable_to_non_nullable
              as String,
      line: null == line
          ? _self.line
          : line // ignore: cast_nullable_to_non_nullable
              as int,
      column: null == column
          ? _self.column
          : column // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

/// Adds pattern-matching-related methods to [CreationLocation].
extension CreationLocationPatterns on CreationLocation {
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
    TResult Function(_CreationLocation value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _CreationLocation() when $default != null:
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
    TResult Function(_CreationLocation value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CreationLocation():
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
    TResult? Function(_CreationLocation value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CreationLocation() when $default != null:
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
    TResult Function(String file, int line, int column)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _CreationLocation() when $default != null:
        return $default(_that.file, _that.line, _that.column);
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
    TResult Function(String file, int line, int column) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CreationLocation():
        return $default(_that.file, _that.line, _that.column);
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
    TResult? Function(String file, int line, int column)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _CreationLocation() when $default != null:
        return $default(_that.file, _that.line, _that.column);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _CreationLocation implements CreationLocation {
  const _CreationLocation(
      {required this.file, required this.line, required this.column});
  factory _CreationLocation.fromJson(Map<String, dynamic> json) =>
      _$CreationLocationFromJson(json);

  @override
  final String file;
  @override
  final int line;
  @override
  final int column;

  /// Create a copy of CreationLocation
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$CreationLocationCopyWith<_CreationLocation> get copyWith =>
      __$CreationLocationCopyWithImpl<_CreationLocation>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$CreationLocationToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _CreationLocation &&
            (identical(other.file, file) || other.file == file) &&
            (identical(other.line, line) || other.line == line) &&
            (identical(other.column, column) || other.column == column));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, file, line, column);

  @override
  String toString() {
    return 'CreationLocation(file: $file, line: $line, column: $column)';
  }
}

/// @nodoc
abstract mixin class _$CreationLocationCopyWith<$Res>
    implements $CreationLocationCopyWith<$Res> {
  factory _$CreationLocationCopyWith(
          _CreationLocation value, $Res Function(_CreationLocation) _then) =
      __$CreationLocationCopyWithImpl;
  @override
  @useResult
  $Res call({String file, int line, int column});
}

/// @nodoc
class __$CreationLocationCopyWithImpl<$Res>
    implements _$CreationLocationCopyWith<$Res> {
  __$CreationLocationCopyWithImpl(this._self, this._then);

  final _CreationLocation _self;
  final $Res Function(_CreationLocation) _then;

  /// Create a copy of CreationLocation
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? file = null,
    Object? line = null,
    Object? column = null,
  }) {
    return _then(_CreationLocation(
      file: null == file
          ? _self.file
          : file // ignore: cast_nullable_to_non_nullable
              as String,
      line: null == line
          ? _self.line
          : line // ignore: cast_nullable_to_non_nullable
              as int,
      column: null == column
          ? _self.column
          : column // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }
}

// dart format on
