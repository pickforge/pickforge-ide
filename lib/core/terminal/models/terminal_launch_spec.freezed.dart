// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'terminal_launch_spec.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$TerminalLaunchSpec {
  @_TerminalIdConverter()
  TerminalProfileId get id;
  String get scriptPath;
  String get workingDir;
  Map<String, String> get env;

  /// Create a copy of TerminalLaunchSpec
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $TerminalLaunchSpecCopyWith<TerminalLaunchSpec> get copyWith =>
      _$TerminalLaunchSpecCopyWithImpl<TerminalLaunchSpec>(
          this as TerminalLaunchSpec, _$identity);

  /// Serializes this TerminalLaunchSpec to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is TerminalLaunchSpec &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.scriptPath, scriptPath) ||
                other.scriptPath == scriptPath) &&
            (identical(other.workingDir, workingDir) ||
                other.workingDir == workingDir) &&
            const DeepCollectionEquality().equals(other.env, env));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, scriptPath, workingDir,
      const DeepCollectionEquality().hash(env));

  @override
  String toString() {
    return 'TerminalLaunchSpec(id: $id, scriptPath: $scriptPath, workingDir: $workingDir, env: $env)';
  }
}

/// @nodoc
abstract mixin class $TerminalLaunchSpecCopyWith<$Res> {
  factory $TerminalLaunchSpecCopyWith(
          TerminalLaunchSpec value, $Res Function(TerminalLaunchSpec) _then) =
      _$TerminalLaunchSpecCopyWithImpl;
  @useResult
  $Res call(
      {@_TerminalIdConverter() TerminalProfileId id,
      String scriptPath,
      String workingDir,
      Map<String, String> env});
}

/// @nodoc
class _$TerminalLaunchSpecCopyWithImpl<$Res>
    implements $TerminalLaunchSpecCopyWith<$Res> {
  _$TerminalLaunchSpecCopyWithImpl(this._self, this._then);

  final TerminalLaunchSpec _self;
  final $Res Function(TerminalLaunchSpec) _then;

  /// Create a copy of TerminalLaunchSpec
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? scriptPath = null,
    Object? workingDir = null,
    Object? env = null,
  }) {
    return _then(_self.copyWith(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as TerminalProfileId,
      scriptPath: null == scriptPath
          ? _self.scriptPath
          : scriptPath // ignore: cast_nullable_to_non_nullable
              as String,
      workingDir: null == workingDir
          ? _self.workingDir
          : workingDir // ignore: cast_nullable_to_non_nullable
              as String,
      env: null == env
          ? _self.env
          : env // ignore: cast_nullable_to_non_nullable
              as Map<String, String>,
    ));
  }
}

/// Adds pattern-matching-related methods to [TerminalLaunchSpec].
extension TerminalLaunchSpecPatterns on TerminalLaunchSpec {
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
    TResult Function(_TerminalLaunchSpec value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _TerminalLaunchSpec() when $default != null:
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
    TResult Function(_TerminalLaunchSpec value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _TerminalLaunchSpec():
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
    TResult? Function(_TerminalLaunchSpec value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _TerminalLaunchSpec() when $default != null:
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
    TResult Function(@_TerminalIdConverter() TerminalProfileId id,
            String scriptPath, String workingDir, Map<String, String> env)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _TerminalLaunchSpec() when $default != null:
        return $default(
            _that.id, _that.scriptPath, _that.workingDir, _that.env);
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
    TResult Function(@_TerminalIdConverter() TerminalProfileId id,
            String scriptPath, String workingDir, Map<String, String> env)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _TerminalLaunchSpec():
        return $default(
            _that.id, _that.scriptPath, _that.workingDir, _that.env);
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
    TResult? Function(@_TerminalIdConverter() TerminalProfileId id,
            String scriptPath, String workingDir, Map<String, String> env)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _TerminalLaunchSpec() when $default != null:
        return $default(
            _that.id, _that.scriptPath, _that.workingDir, _that.env);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _TerminalLaunchSpec implements TerminalLaunchSpec {
  const _TerminalLaunchSpec(
      {@_TerminalIdConverter() required this.id,
      required this.scriptPath,
      required this.workingDir,
      required final Map<String, String> env})
      : _env = env;
  factory _TerminalLaunchSpec.fromJson(Map<String, dynamic> json) =>
      _$TerminalLaunchSpecFromJson(json);

  @override
  @_TerminalIdConverter()
  final TerminalProfileId id;
  @override
  final String scriptPath;
  @override
  final String workingDir;
  final Map<String, String> _env;
  @override
  Map<String, String> get env {
    if (_env is EqualUnmodifiableMapView) return _env;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(_env);
  }

  /// Create a copy of TerminalLaunchSpec
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$TerminalLaunchSpecCopyWith<_TerminalLaunchSpec> get copyWith =>
      __$TerminalLaunchSpecCopyWithImpl<_TerminalLaunchSpec>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$TerminalLaunchSpecToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _TerminalLaunchSpec &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.scriptPath, scriptPath) ||
                other.scriptPath == scriptPath) &&
            (identical(other.workingDir, workingDir) ||
                other.workingDir == workingDir) &&
            const DeepCollectionEquality().equals(other._env, _env));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, scriptPath, workingDir,
      const DeepCollectionEquality().hash(_env));

  @override
  String toString() {
    return 'TerminalLaunchSpec(id: $id, scriptPath: $scriptPath, workingDir: $workingDir, env: $env)';
  }
}

/// @nodoc
abstract mixin class _$TerminalLaunchSpecCopyWith<$Res>
    implements $TerminalLaunchSpecCopyWith<$Res> {
  factory _$TerminalLaunchSpecCopyWith(
          _TerminalLaunchSpec value, $Res Function(_TerminalLaunchSpec) _then) =
      __$TerminalLaunchSpecCopyWithImpl;
  @override
  @useResult
  $Res call(
      {@_TerminalIdConverter() TerminalProfileId id,
      String scriptPath,
      String workingDir,
      Map<String, String> env});
}

/// @nodoc
class __$TerminalLaunchSpecCopyWithImpl<$Res>
    implements _$TerminalLaunchSpecCopyWith<$Res> {
  __$TerminalLaunchSpecCopyWithImpl(this._self, this._then);

  final _TerminalLaunchSpec _self;
  final $Res Function(_TerminalLaunchSpec) _then;

  /// Create a copy of TerminalLaunchSpec
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? scriptPath = null,
    Object? workingDir = null,
    Object? env = null,
  }) {
    return _then(_TerminalLaunchSpec(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as TerminalProfileId,
      scriptPath: null == scriptPath
          ? _self.scriptPath
          : scriptPath // ignore: cast_nullable_to_non_nullable
              as String,
      workingDir: null == workingDir
          ? _self.workingDir
          : workingDir // ignore: cast_nullable_to_non_nullable
              as String,
      env: null == env
          ? _self._env
          : env // ignore: cast_nullable_to_non_nullable
              as Map<String, String>,
    ));
  }
}

// dart format on
