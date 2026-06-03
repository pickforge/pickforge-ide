// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'forge_request.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ForgeRequest {
  @_AgentProfileIdConverter()
  AgentProfileId get agentId;
  @_SkillIdConverter()
  SkillId get skill;
  SelectedWidget get widget;
  String get terminalId;
  String get projectRoot;
  List<String> get attachmentPaths;
  String get customNote;

  /// Create a copy of ForgeRequest
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ForgeRequestCopyWith<ForgeRequest> get copyWith =>
      _$ForgeRequestCopyWithImpl<ForgeRequest>(
          this as ForgeRequest, _$identity);

  /// Serializes this ForgeRequest to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is ForgeRequest &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.skill, skill) || other.skill == skill) &&
            (identical(other.widget, widget) || other.widget == widget) &&
            (identical(other.terminalId, terminalId) ||
                other.terminalId == terminalId) &&
            (identical(other.projectRoot, projectRoot) ||
                other.projectRoot == projectRoot) &&
            const DeepCollectionEquality()
                .equals(other.attachmentPaths, attachmentPaths) &&
            (identical(other.customNote, customNote) ||
                other.customNote == customNote));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      agentId,
      skill,
      widget,
      terminalId,
      projectRoot,
      const DeepCollectionEquality().hash(attachmentPaths),
      customNote);

  @override
  String toString() {
    return 'ForgeRequest(agentId: $agentId, skill: $skill, widget: $widget, terminalId: $terminalId, projectRoot: $projectRoot, attachmentPaths: $attachmentPaths, customNote: $customNote)';
  }
}

/// @nodoc
abstract mixin class $ForgeRequestCopyWith<$Res> {
  factory $ForgeRequestCopyWith(
          ForgeRequest value, $Res Function(ForgeRequest) _then) =
      _$ForgeRequestCopyWithImpl;
  @useResult
  $Res call(
      {@_AgentProfileIdConverter() AgentProfileId agentId,
      @_SkillIdConverter() SkillId skill,
      SelectedWidget widget,
      String terminalId,
      String projectRoot,
      List<String> attachmentPaths,
      String customNote});

  $SelectedWidgetCopyWith<$Res> get widget;
}

/// @nodoc
class _$ForgeRequestCopyWithImpl<$Res> implements $ForgeRequestCopyWith<$Res> {
  _$ForgeRequestCopyWithImpl(this._self, this._then);

  final ForgeRequest _self;
  final $Res Function(ForgeRequest) _then;

  /// Create a copy of ForgeRequest
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? agentId = null,
    Object? skill = null,
    Object? widget = null,
    Object? terminalId = null,
    Object? projectRoot = null,
    Object? attachmentPaths = null,
    Object? customNote = null,
  }) {
    return _then(_self.copyWith(
      agentId: null == agentId
          ? _self.agentId
          : agentId // ignore: cast_nullable_to_non_nullable
              as AgentProfileId,
      skill: null == skill
          ? _self.skill
          : skill // ignore: cast_nullable_to_non_nullable
              as SkillId,
      widget: null == widget
          ? _self.widget
          : widget // ignore: cast_nullable_to_non_nullable
              as SelectedWidget,
      terminalId: null == terminalId
          ? _self.terminalId
          : terminalId // ignore: cast_nullable_to_non_nullable
              as String,
      projectRoot: null == projectRoot
          ? _self.projectRoot
          : projectRoot // ignore: cast_nullable_to_non_nullable
              as String,
      attachmentPaths: null == attachmentPaths
          ? _self.attachmentPaths
          : attachmentPaths // ignore: cast_nullable_to_non_nullable
              as List<String>,
      customNote: null == customNote
          ? _self.customNote
          : customNote // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }

  /// Create a copy of ForgeRequest
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $SelectedWidgetCopyWith<$Res> get widget {
    return $SelectedWidgetCopyWith<$Res>(_self.widget, (value) {
      return _then(_self.copyWith(widget: value));
    });
  }
}

/// Adds pattern-matching-related methods to [ForgeRequest].
extension ForgeRequestPatterns on ForgeRequest {
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
    TResult Function(_ForgeRequest value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _ForgeRequest() when $default != null:
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
    TResult Function(_ForgeRequest value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeRequest():
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
    TResult? Function(_ForgeRequest value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeRequest() when $default != null:
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
    TResult Function(
            @_AgentProfileIdConverter() AgentProfileId agentId,
            @_SkillIdConverter() SkillId skill,
            SelectedWidget widget,
            String terminalId,
            String projectRoot,
            List<String> attachmentPaths,
            String customNote)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _ForgeRequest() when $default != null:
        return $default(
            _that.agentId,
            _that.skill,
            _that.widget,
            _that.terminalId,
            _that.projectRoot,
            _that.attachmentPaths,
            _that.customNote);
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
    TResult Function(
            @_AgentProfileIdConverter() AgentProfileId agentId,
            @_SkillIdConverter() SkillId skill,
            SelectedWidget widget,
            String terminalId,
            String projectRoot,
            List<String> attachmentPaths,
            String customNote)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeRequest():
        return $default(
            _that.agentId,
            _that.skill,
            _that.widget,
            _that.terminalId,
            _that.projectRoot,
            _that.attachmentPaths,
            _that.customNote);
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
    TResult? Function(
            @_AgentProfileIdConverter() AgentProfileId agentId,
            @_SkillIdConverter() SkillId skill,
            SelectedWidget widget,
            String terminalId,
            String projectRoot,
            List<String> attachmentPaths,
            String customNote)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _ForgeRequest() when $default != null:
        return $default(
            _that.agentId,
            _that.skill,
            _that.widget,
            _that.terminalId,
            _that.projectRoot,
            _that.attachmentPaths,
            _that.customNote);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _ForgeRequest implements ForgeRequest {
  const _ForgeRequest(
      {@_AgentProfileIdConverter() required this.agentId,
      @_SkillIdConverter() required this.skill,
      required this.widget,
      required this.terminalId,
      required this.projectRoot,
      final List<String> attachmentPaths = const [],
      this.customNote = ''})
      : _attachmentPaths = attachmentPaths;
  factory _ForgeRequest.fromJson(Map<String, dynamic> json) =>
      _$ForgeRequestFromJson(json);

  @override
  @_AgentProfileIdConverter()
  final AgentProfileId agentId;
  @override
  @_SkillIdConverter()
  final SkillId skill;
  @override
  final SelectedWidget widget;
  @override
  final String terminalId;
  @override
  final String projectRoot;
  final List<String> _attachmentPaths;
  @override
  @JsonKey()
  List<String> get attachmentPaths {
    if (_attachmentPaths is EqualUnmodifiableListView) return _attachmentPaths;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_attachmentPaths);
  }

  @override
  @JsonKey()
  final String customNote;

  /// Create a copy of ForgeRequest
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$ForgeRequestCopyWith<_ForgeRequest> get copyWith =>
      __$ForgeRequestCopyWithImpl<_ForgeRequest>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$ForgeRequestToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _ForgeRequest &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.skill, skill) || other.skill == skill) &&
            (identical(other.widget, widget) || other.widget == widget) &&
            (identical(other.terminalId, terminalId) ||
                other.terminalId == terminalId) &&
            (identical(other.projectRoot, projectRoot) ||
                other.projectRoot == projectRoot) &&
            const DeepCollectionEquality()
                .equals(other._attachmentPaths, _attachmentPaths) &&
            (identical(other.customNote, customNote) ||
                other.customNote == customNote));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      agentId,
      skill,
      widget,
      terminalId,
      projectRoot,
      const DeepCollectionEquality().hash(_attachmentPaths),
      customNote);

  @override
  String toString() {
    return 'ForgeRequest(agentId: $agentId, skill: $skill, widget: $widget, terminalId: $terminalId, projectRoot: $projectRoot, attachmentPaths: $attachmentPaths, customNote: $customNote)';
  }
}

/// @nodoc
abstract mixin class _$ForgeRequestCopyWith<$Res>
    implements $ForgeRequestCopyWith<$Res> {
  factory _$ForgeRequestCopyWith(
          _ForgeRequest value, $Res Function(_ForgeRequest) _then) =
      __$ForgeRequestCopyWithImpl;
  @override
  @useResult
  $Res call(
      {@_AgentProfileIdConverter() AgentProfileId agentId,
      @_SkillIdConverter() SkillId skill,
      SelectedWidget widget,
      String terminalId,
      String projectRoot,
      List<String> attachmentPaths,
      String customNote});

  @override
  $SelectedWidgetCopyWith<$Res> get widget;
}

/// @nodoc
class __$ForgeRequestCopyWithImpl<$Res>
    implements _$ForgeRequestCopyWith<$Res> {
  __$ForgeRequestCopyWithImpl(this._self, this._then);

  final _ForgeRequest _self;
  final $Res Function(_ForgeRequest) _then;

  /// Create a copy of ForgeRequest
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? agentId = null,
    Object? skill = null,
    Object? widget = null,
    Object? terminalId = null,
    Object? projectRoot = null,
    Object? attachmentPaths = null,
    Object? customNote = null,
  }) {
    return _then(_ForgeRequest(
      agentId: null == agentId
          ? _self.agentId
          : agentId // ignore: cast_nullable_to_non_nullable
              as AgentProfileId,
      skill: null == skill
          ? _self.skill
          : skill // ignore: cast_nullable_to_non_nullable
              as SkillId,
      widget: null == widget
          ? _self.widget
          : widget // ignore: cast_nullable_to_non_nullable
              as SelectedWidget,
      terminalId: null == terminalId
          ? _self.terminalId
          : terminalId // ignore: cast_nullable_to_non_nullable
              as String,
      projectRoot: null == projectRoot
          ? _self.projectRoot
          : projectRoot // ignore: cast_nullable_to_non_nullable
              as String,
      attachmentPaths: null == attachmentPaths
          ? _self._attachmentPaths
          : attachmentPaths // ignore: cast_nullable_to_non_nullable
              as List<String>,
      customNote: null == customNote
          ? _self.customNote
          : customNote // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }

  /// Create a copy of ForgeRequest
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $SelectedWidgetCopyWith<$Res> get widget {
    return $SelectedWidgetCopyWith<$Res>(_self.widget, (value) {
      return _then(_self.copyWith(widget: value));
    });
  }
}

// dart format on
