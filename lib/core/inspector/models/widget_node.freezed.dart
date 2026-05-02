// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'widget_node.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$WidgetNode {
  String get id;
  String get className;
  List<WidgetNode> get children;
  CreationLocation? get creationLocation;

  /// Create a copy of WidgetNode
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $WidgetNodeCopyWith<WidgetNode> get copyWith =>
      _$WidgetNodeCopyWithImpl<WidgetNode>(this as WidgetNode, _$identity);

  /// Serializes this WidgetNode to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is WidgetNode &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.className, className) ||
                other.className == className) &&
            const DeepCollectionEquality().equals(other.children, children) &&
            (identical(other.creationLocation, creationLocation) ||
                other.creationLocation == creationLocation));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, className,
      const DeepCollectionEquality().hash(children), creationLocation);

  @override
  String toString() {
    return 'WidgetNode(id: $id, className: $className, children: $children, creationLocation: $creationLocation)';
  }
}

/// @nodoc
abstract mixin class $WidgetNodeCopyWith<$Res> {
  factory $WidgetNodeCopyWith(
          WidgetNode value, $Res Function(WidgetNode) _then) =
      _$WidgetNodeCopyWithImpl;
  @useResult
  $Res call(
      {String id,
      String className,
      List<WidgetNode> children,
      CreationLocation? creationLocation});

  $CreationLocationCopyWith<$Res>? get creationLocation;
}

/// @nodoc
class _$WidgetNodeCopyWithImpl<$Res> implements $WidgetNodeCopyWith<$Res> {
  _$WidgetNodeCopyWithImpl(this._self, this._then);

  final WidgetNode _self;
  final $Res Function(WidgetNode) _then;

  /// Create a copy of WidgetNode
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? className = null,
    Object? children = null,
    Object? creationLocation = freezed,
  }) {
    return _then(_self.copyWith(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      className: null == className
          ? _self.className
          : className // ignore: cast_nullable_to_non_nullable
              as String,
      children: null == children
          ? _self.children
          : children // ignore: cast_nullable_to_non_nullable
              as List<WidgetNode>,
      creationLocation: freezed == creationLocation
          ? _self.creationLocation
          : creationLocation // ignore: cast_nullable_to_non_nullable
              as CreationLocation?,
    ));
  }

  /// Create a copy of WidgetNode
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $CreationLocationCopyWith<$Res>? get creationLocation {
    if (_self.creationLocation == null) {
      return null;
    }

    return $CreationLocationCopyWith<$Res>(_self.creationLocation!, (value) {
      return _then(_self.copyWith(creationLocation: value));
    });
  }
}

/// Adds pattern-matching-related methods to [WidgetNode].
extension WidgetNodePatterns on WidgetNode {
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
    TResult Function(_WidgetNode value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _WidgetNode() when $default != null:
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
    TResult Function(_WidgetNode value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetNode():
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
    TResult? Function(_WidgetNode value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetNode() when $default != null:
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
    TResult Function(String id, String className, List<WidgetNode> children,
            CreationLocation? creationLocation)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _WidgetNode() when $default != null:
        return $default(
            _that.id, _that.className, _that.children, _that.creationLocation);
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
    TResult Function(String id, String className, List<WidgetNode> children,
            CreationLocation? creationLocation)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetNode():
        return $default(
            _that.id, _that.className, _that.children, _that.creationLocation);
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
    TResult? Function(String id, String className, List<WidgetNode> children,
            CreationLocation? creationLocation)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetNode() when $default != null:
        return $default(
            _that.id, _that.className, _that.children, _that.creationLocation);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _WidgetNode extends WidgetNode {
  const _WidgetNode(
      {required this.id,
      required this.className,
      required final List<WidgetNode> children,
      required this.creationLocation})
      : _children = children,
        super._();
  factory _WidgetNode.fromJson(Map<String, dynamic> json) =>
      _$WidgetNodeFromJson(json);

  @override
  final String id;
  @override
  final String className;
  final List<WidgetNode> _children;
  @override
  List<WidgetNode> get children {
    if (_children is EqualUnmodifiableListView) return _children;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_children);
  }

  @override
  final CreationLocation? creationLocation;

  /// Create a copy of WidgetNode
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$WidgetNodeCopyWith<_WidgetNode> get copyWith =>
      __$WidgetNodeCopyWithImpl<_WidgetNode>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$WidgetNodeToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _WidgetNode &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.className, className) ||
                other.className == className) &&
            const DeepCollectionEquality().equals(other._children, _children) &&
            (identical(other.creationLocation, creationLocation) ||
                other.creationLocation == creationLocation));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, className,
      const DeepCollectionEquality().hash(_children), creationLocation);

  @override
  String toString() {
    return 'WidgetNode(id: $id, className: $className, children: $children, creationLocation: $creationLocation)';
  }
}

/// @nodoc
abstract mixin class _$WidgetNodeCopyWith<$Res>
    implements $WidgetNodeCopyWith<$Res> {
  factory _$WidgetNodeCopyWith(
          _WidgetNode value, $Res Function(_WidgetNode) _then) =
      __$WidgetNodeCopyWithImpl;
  @override
  @useResult
  $Res call(
      {String id,
      String className,
      List<WidgetNode> children,
      CreationLocation? creationLocation});

  @override
  $CreationLocationCopyWith<$Res>? get creationLocation;
}

/// @nodoc
class __$WidgetNodeCopyWithImpl<$Res> implements _$WidgetNodeCopyWith<$Res> {
  __$WidgetNodeCopyWithImpl(this._self, this._then);

  final _WidgetNode _self;
  final $Res Function(_WidgetNode) _then;

  /// Create a copy of WidgetNode
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? id = null,
    Object? className = null,
    Object? children = null,
    Object? creationLocation = freezed,
  }) {
    return _then(_WidgetNode(
      id: null == id
          ? _self.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      className: null == className
          ? _self.className
          : className // ignore: cast_nullable_to_non_nullable
              as String,
      children: null == children
          ? _self._children
          : children // ignore: cast_nullable_to_non_nullable
              as List<WidgetNode>,
      creationLocation: freezed == creationLocation
          ? _self.creationLocation
          : creationLocation // ignore: cast_nullable_to_non_nullable
              as CreationLocation?,
    ));
  }

  /// Create a copy of WidgetNode
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $CreationLocationCopyWith<$Res>? get creationLocation {
    if (_self.creationLocation == null) {
      return null;
    }

    return $CreationLocationCopyWith<$Res>(_self.creationLocation!, (value) {
      return _then(_self.copyWith(creationLocation: value));
    });
  }
}

// dart format on
