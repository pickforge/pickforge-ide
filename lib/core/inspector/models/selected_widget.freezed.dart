// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'selected_widget.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$SelectedWidget {
  WidgetNode get node;
  List<String> get ancestorClasses;
  String? get sourceSnippet;
  String? get screenshotPath;
  String? get adbScreenshotPath;
  Map<String, dynamic> get propertiesJson;

  /// Create a copy of SelectedWidget
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $SelectedWidgetCopyWith<SelectedWidget> get copyWith =>
      _$SelectedWidgetCopyWithImpl<SelectedWidget>(
          this as SelectedWidget, _$identity);

  /// Serializes this SelectedWidget to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is SelectedWidget &&
            (identical(other.node, node) || other.node == node) &&
            const DeepCollectionEquality()
                .equals(other.ancestorClasses, ancestorClasses) &&
            (identical(other.sourceSnippet, sourceSnippet) ||
                other.sourceSnippet == sourceSnippet) &&
            (identical(other.screenshotPath, screenshotPath) ||
                other.screenshotPath == screenshotPath) &&
            (identical(other.adbScreenshotPath, adbScreenshotPath) ||
                other.adbScreenshotPath == adbScreenshotPath) &&
            const DeepCollectionEquality()
                .equals(other.propertiesJson, propertiesJson));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      node,
      const DeepCollectionEquality().hash(ancestorClasses),
      sourceSnippet,
      screenshotPath,
      adbScreenshotPath,
      const DeepCollectionEquality().hash(propertiesJson));

  @override
  String toString() {
    return 'SelectedWidget(node: $node, ancestorClasses: $ancestorClasses, sourceSnippet: $sourceSnippet, screenshotPath: $screenshotPath, adbScreenshotPath: $adbScreenshotPath, propertiesJson: $propertiesJson)';
  }
}

/// @nodoc
abstract mixin class $SelectedWidgetCopyWith<$Res> {
  factory $SelectedWidgetCopyWith(
          SelectedWidget value, $Res Function(SelectedWidget) _then) =
      _$SelectedWidgetCopyWithImpl;
  @useResult
  $Res call(
      {WidgetNode node,
      List<String> ancestorClasses,
      String? sourceSnippet,
      String? screenshotPath,
      String? adbScreenshotPath,
      Map<String, dynamic> propertiesJson});

  $WidgetNodeCopyWith<$Res> get node;
}

/// @nodoc
class _$SelectedWidgetCopyWithImpl<$Res>
    implements $SelectedWidgetCopyWith<$Res> {
  _$SelectedWidgetCopyWithImpl(this._self, this._then);

  final SelectedWidget _self;
  final $Res Function(SelectedWidget) _then;

  /// Create a copy of SelectedWidget
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? node = null,
    Object? ancestorClasses = null,
    Object? sourceSnippet = freezed,
    Object? screenshotPath = freezed,
    Object? adbScreenshotPath = freezed,
    Object? propertiesJson = null,
  }) {
    return _then(_self.copyWith(
      node: null == node
          ? _self.node
          : node // ignore: cast_nullable_to_non_nullable
              as WidgetNode,
      ancestorClasses: null == ancestorClasses
          ? _self.ancestorClasses
          : ancestorClasses // ignore: cast_nullable_to_non_nullable
              as List<String>,
      sourceSnippet: freezed == sourceSnippet
          ? _self.sourceSnippet
          : sourceSnippet // ignore: cast_nullable_to_non_nullable
              as String?,
      screenshotPath: freezed == screenshotPath
          ? _self.screenshotPath
          : screenshotPath // ignore: cast_nullable_to_non_nullable
              as String?,
      adbScreenshotPath: freezed == adbScreenshotPath
          ? _self.adbScreenshotPath
          : adbScreenshotPath // ignore: cast_nullable_to_non_nullable
              as String?,
      propertiesJson: null == propertiesJson
          ? _self.propertiesJson
          : propertiesJson // ignore: cast_nullable_to_non_nullable
              as Map<String, dynamic>,
    ));
  }

  /// Create a copy of SelectedWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $WidgetNodeCopyWith<$Res> get node {
    return $WidgetNodeCopyWith<$Res>(_self.node, (value) {
      return _then(_self.copyWith(node: value));
    });
  }
}

/// Adds pattern-matching-related methods to [SelectedWidget].
extension SelectedWidgetPatterns on SelectedWidget {
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
    TResult Function(_SelectedWidget value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _SelectedWidget() when $default != null:
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
    TResult Function(_SelectedWidget value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _SelectedWidget():
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
    TResult? Function(_SelectedWidget value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _SelectedWidget() when $default != null:
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
            WidgetNode node,
            List<String> ancestorClasses,
            String? sourceSnippet,
            String? screenshotPath,
            String? adbScreenshotPath,
            Map<String, dynamic> propertiesJson)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _SelectedWidget() when $default != null:
        return $default(
            _that.node,
            _that.ancestorClasses,
            _that.sourceSnippet,
            _that.screenshotPath,
            _that.adbScreenshotPath,
            _that.propertiesJson);
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
            WidgetNode node,
            List<String> ancestorClasses,
            String? sourceSnippet,
            String? screenshotPath,
            String? adbScreenshotPath,
            Map<String, dynamic> propertiesJson)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _SelectedWidget():
        return $default(
            _that.node,
            _that.ancestorClasses,
            _that.sourceSnippet,
            _that.screenshotPath,
            _that.adbScreenshotPath,
            _that.propertiesJson);
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
            WidgetNode node,
            List<String> ancestorClasses,
            String? sourceSnippet,
            String? screenshotPath,
            String? adbScreenshotPath,
            Map<String, dynamic> propertiesJson)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _SelectedWidget() when $default != null:
        return $default(
            _that.node,
            _that.ancestorClasses,
            _that.sourceSnippet,
            _that.screenshotPath,
            _that.adbScreenshotPath,
            _that.propertiesJson);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _SelectedWidget implements SelectedWidget {
  const _SelectedWidget(
      {required this.node,
      required final List<String> ancestorClasses,
      required this.sourceSnippet,
      required this.screenshotPath,
      required this.adbScreenshotPath,
      required final Map<String, dynamic> propertiesJson})
      : _ancestorClasses = ancestorClasses,
        _propertiesJson = propertiesJson;
  factory _SelectedWidget.fromJson(Map<String, dynamic> json) =>
      _$SelectedWidgetFromJson(json);

  @override
  final WidgetNode node;
  final List<String> _ancestorClasses;
  @override
  List<String> get ancestorClasses {
    if (_ancestorClasses is EqualUnmodifiableListView) return _ancestorClasses;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_ancestorClasses);
  }

  @override
  final String? sourceSnippet;
  @override
  final String? screenshotPath;
  @override
  final String? adbScreenshotPath;
  final Map<String, dynamic> _propertiesJson;
  @override
  Map<String, dynamic> get propertiesJson {
    if (_propertiesJson is EqualUnmodifiableMapView) return _propertiesJson;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(_propertiesJson);
  }

  /// Create a copy of SelectedWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$SelectedWidgetCopyWith<_SelectedWidget> get copyWith =>
      __$SelectedWidgetCopyWithImpl<_SelectedWidget>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$SelectedWidgetToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _SelectedWidget &&
            (identical(other.node, node) || other.node == node) &&
            const DeepCollectionEquality()
                .equals(other._ancestorClasses, _ancestorClasses) &&
            (identical(other.sourceSnippet, sourceSnippet) ||
                other.sourceSnippet == sourceSnippet) &&
            (identical(other.screenshotPath, screenshotPath) ||
                other.screenshotPath == screenshotPath) &&
            (identical(other.adbScreenshotPath, adbScreenshotPath) ||
                other.adbScreenshotPath == adbScreenshotPath) &&
            const DeepCollectionEquality()
                .equals(other._propertiesJson, _propertiesJson));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      node,
      const DeepCollectionEquality().hash(_ancestorClasses),
      sourceSnippet,
      screenshotPath,
      adbScreenshotPath,
      const DeepCollectionEquality().hash(_propertiesJson));

  @override
  String toString() {
    return 'SelectedWidget(node: $node, ancestorClasses: $ancestorClasses, sourceSnippet: $sourceSnippet, screenshotPath: $screenshotPath, adbScreenshotPath: $adbScreenshotPath, propertiesJson: $propertiesJson)';
  }
}

/// @nodoc
abstract mixin class _$SelectedWidgetCopyWith<$Res>
    implements $SelectedWidgetCopyWith<$Res> {
  factory _$SelectedWidgetCopyWith(
          _SelectedWidget value, $Res Function(_SelectedWidget) _then) =
      __$SelectedWidgetCopyWithImpl;
  @override
  @useResult
  $Res call(
      {WidgetNode node,
      List<String> ancestorClasses,
      String? sourceSnippet,
      String? screenshotPath,
      String? adbScreenshotPath,
      Map<String, dynamic> propertiesJson});

  @override
  $WidgetNodeCopyWith<$Res> get node;
}

/// @nodoc
class __$SelectedWidgetCopyWithImpl<$Res>
    implements _$SelectedWidgetCopyWith<$Res> {
  __$SelectedWidgetCopyWithImpl(this._self, this._then);

  final _SelectedWidget _self;
  final $Res Function(_SelectedWidget) _then;

  /// Create a copy of SelectedWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? node = null,
    Object? ancestorClasses = null,
    Object? sourceSnippet = freezed,
    Object? screenshotPath = freezed,
    Object? adbScreenshotPath = freezed,
    Object? propertiesJson = null,
  }) {
    return _then(_SelectedWidget(
      node: null == node
          ? _self.node
          : node // ignore: cast_nullable_to_non_nullable
              as WidgetNode,
      ancestorClasses: null == ancestorClasses
          ? _self._ancestorClasses
          : ancestorClasses // ignore: cast_nullable_to_non_nullable
              as List<String>,
      sourceSnippet: freezed == sourceSnippet
          ? _self.sourceSnippet
          : sourceSnippet // ignore: cast_nullable_to_non_nullable
              as String?,
      screenshotPath: freezed == screenshotPath
          ? _self.screenshotPath
          : screenshotPath // ignore: cast_nullable_to_non_nullable
              as String?,
      adbScreenshotPath: freezed == adbScreenshotPath
          ? _self.adbScreenshotPath
          : adbScreenshotPath // ignore: cast_nullable_to_non_nullable
              as String?,
      propertiesJson: null == propertiesJson
          ? _self._propertiesJson
          : propertiesJson // ignore: cast_nullable_to_non_nullable
              as Map<String, dynamic>,
    ));
  }

  /// Create a copy of SelectedWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $WidgetNodeCopyWith<$Res> get node {
    return $WidgetNodeCopyWith<$Res>(_self.node, (value) {
      return _then(_self.copyWith(node: value));
    });
  }
}

// dart format on
