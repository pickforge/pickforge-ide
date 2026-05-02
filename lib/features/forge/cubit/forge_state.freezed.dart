// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'forge_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ForgeState {
  SkillId get skill;
  AgentProfileId get agentId;
  String get terminalId;
  bool get launching;
  String? get lastError;

  /// Create a copy of ForgeState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ForgeStateCopyWith<ForgeState> get copyWith =>
      _$ForgeStateCopyWithImpl<ForgeState>(this as ForgeState, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is ForgeState &&
            (identical(other.skill, skill) || other.skill == skill) &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.terminalId, terminalId) ||
                other.terminalId == terminalId) &&
            (identical(other.launching, launching) ||
                other.launching == launching) &&
            (identical(other.lastError, lastError) ||
                other.lastError == lastError));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, skill, agentId, terminalId, launching, lastError);

  @override
  String toString() {
    return 'ForgeState(skill: $skill, agentId: $agentId, terminalId: $terminalId, launching: $launching, lastError: $lastError)';
  }
}

/// @nodoc
abstract mixin class $ForgeStateCopyWith<$Res> {
  factory $ForgeStateCopyWith(
          ForgeState value, $Res Function(ForgeState) _then) =
      _$ForgeStateCopyWithImpl;
  @useResult
  $Res call(
      {SkillId skill,
      AgentProfileId agentId,
      String terminalId,
      bool launching,
      String? lastError});
}

/// @nodoc
class _$ForgeStateCopyWithImpl<$Res> implements $ForgeStateCopyWith<$Res> {
  _$ForgeStateCopyWithImpl(this._self, this._then);

  final ForgeState _self;
  final $Res Function(ForgeState) _then;

  /// Create a copy of ForgeState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? skill = null,
    Object? agentId = null,
    Object? terminalId = null,
    Object? launching = null,
    Object? lastError = freezed,
  }) {
    return _then(_self.copyWith(
      skill: null == skill
          ? _self.skill
          : skill // ignore: cast_nullable_to_non_nullable
              as SkillId,
      agentId: null == agentId
          ? _self.agentId
          : agentId // ignore: cast_nullable_to_non_nullable
              as AgentProfileId,
      terminalId: null == terminalId
          ? _self.terminalId
          : terminalId // ignore: cast_nullable_to_non_nullable
              as String,
      launching: null == launching
          ? _self.launching
          : launching // ignore: cast_nullable_to_non_nullable
              as bool,
      lastError: freezed == lastError
          ? _self.lastError
          : lastError // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// Adds pattern-matching-related methods to [ForgeState].
extension ForgeStatePatterns on ForgeState {
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
    TResult Function(_ForgeState value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _ForgeState() when $default != null:
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
    TResult Function(_ForgeState value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeState():
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
    TResult? Function(_ForgeState value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeState() when $default != null:
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
    TResult Function(SkillId skill, AgentProfileId agentId, String terminalId,
            bool launching, String? lastError)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _ForgeState() when $default != null:
        return $default(_that.skill, _that.agentId, _that.terminalId,
            _that.launching, _that.lastError);
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
    TResult Function(SkillId skill, AgentProfileId agentId, String terminalId,
            bool launching, String? lastError)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeState():
        return $default(_that.skill, _that.agentId, _that.terminalId,
            _that.launching, _that.lastError);
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
    TResult? Function(SkillId skill, AgentProfileId agentId, String terminalId,
            bool launching, String? lastError)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeState() when $default != null:
        return $default(_that.skill, _that.agentId, _that.terminalId,
            _that.launching, _that.lastError);
      case _:
        return null;
    }
  }
}

/// @nodoc

class _ForgeState implements ForgeState {
  const _ForgeState(
      {required this.skill,
      required this.agentId,
      required this.terminalId,
      required this.launching,
      required this.lastError});

  @override
  final SkillId skill;
  @override
  final AgentProfileId agentId;
  @override
  final String terminalId;
  @override
  final bool launching;
  @override
  final String? lastError;

  /// Create a copy of ForgeState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$ForgeStateCopyWith<_ForgeState> get copyWith =>
      __$ForgeStateCopyWithImpl<_ForgeState>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _ForgeState &&
            (identical(other.skill, skill) || other.skill == skill) &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.terminalId, terminalId) ||
                other.terminalId == terminalId) &&
            (identical(other.launching, launching) ||
                other.launching == launching) &&
            (identical(other.lastError, lastError) ||
                other.lastError == lastError));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, skill, agentId, terminalId, launching, lastError);

  @override
  String toString() {
    return 'ForgeState(skill: $skill, agentId: $agentId, terminalId: $terminalId, launching: $launching, lastError: $lastError)';
  }
}

/// @nodoc
abstract mixin class _$ForgeStateCopyWith<$Res>
    implements $ForgeStateCopyWith<$Res> {
  factory _$ForgeStateCopyWith(
          _ForgeState value, $Res Function(_ForgeState) _then) =
      __$ForgeStateCopyWithImpl;
  @override
  @useResult
  $Res call(
      {SkillId skill,
      AgentProfileId agentId,
      String terminalId,
      bool launching,
      String? lastError});
}

/// @nodoc
class __$ForgeStateCopyWithImpl<$Res> implements _$ForgeStateCopyWith<$Res> {
  __$ForgeStateCopyWithImpl(this._self, this._then);

  final _ForgeState _self;
  final $Res Function(_ForgeState) _then;

  /// Create a copy of ForgeState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? skill = null,
    Object? agentId = null,
    Object? terminalId = null,
    Object? launching = null,
    Object? lastError = freezed,
  }) {
    return _then(_ForgeState(
      skill: null == skill
          ? _self.skill
          : skill // ignore: cast_nullable_to_non_nullable
              as SkillId,
      agentId: null == agentId
          ? _self.agentId
          : agentId // ignore: cast_nullable_to_non_nullable
              as AgentProfileId,
      terminalId: null == terminalId
          ? _self.terminalId
          : terminalId // ignore: cast_nullable_to_non_nullable
              as String,
      launching: null == launching
          ? _self.launching
          : launching // ignore: cast_nullable_to_non_nullable
              as bool,
      lastError: freezed == lastError
          ? _self.lastError
          : lastError // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

// dart format on
