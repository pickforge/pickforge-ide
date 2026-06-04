// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'rebuild_stats.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$RebuildStats {
  int? get frameNumber;
  int? get startTime;
  List<RebuiltWidget> get widgets;

  /// Create a copy of RebuildStats
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $RebuildStatsCopyWith<RebuildStats> get copyWith =>
      _$RebuildStatsCopyWithImpl<RebuildStats>(
          this as RebuildStats, _$identity);

  /// Serializes this RebuildStats to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is RebuildStats &&
            (identical(other.frameNumber, frameNumber) ||
                other.frameNumber == frameNumber) &&
            (identical(other.startTime, startTime) ||
                other.startTime == startTime) &&
            const DeepCollectionEquality().equals(other.widgets, widgets));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, frameNumber, startTime,
      const DeepCollectionEquality().hash(widgets));

  @override
  String toString() {
    return 'RebuildStats(frameNumber: $frameNumber, startTime: $startTime, widgets: $widgets)';
  }
}

/// @nodoc
abstract mixin class $RebuildStatsCopyWith<$Res> {
  factory $RebuildStatsCopyWith(
          RebuildStats value, $Res Function(RebuildStats) _then) =
      _$RebuildStatsCopyWithImpl;
  @useResult
  $Res call({int? frameNumber, int? startTime, List<RebuiltWidget> widgets});
}

/// @nodoc
class _$RebuildStatsCopyWithImpl<$Res> implements $RebuildStatsCopyWith<$Res> {
  _$RebuildStatsCopyWithImpl(this._self, this._then);

  final RebuildStats _self;
  final $Res Function(RebuildStats) _then;

  /// Create a copy of RebuildStats
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? frameNumber = freezed,
    Object? startTime = freezed,
    Object? widgets = null,
  }) {
    return _then(_self.copyWith(
      frameNumber: freezed == frameNumber
          ? _self.frameNumber
          : frameNumber // ignore: cast_nullable_to_non_nullable
              as int?,
      startTime: freezed == startTime
          ? _self.startTime
          : startTime // ignore: cast_nullable_to_non_nullable
              as int?,
      widgets: null == widgets
          ? _self.widgets
          : widgets // ignore: cast_nullable_to_non_nullable
              as List<RebuiltWidget>,
    ));
  }
}

/// Adds pattern-matching-related methods to [RebuildStats].
extension RebuildStatsPatterns on RebuildStats {
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
    TResult Function(_RebuildStats value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _RebuildStats() when $default != null:
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
    TResult Function(_RebuildStats value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuildStats():
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
    TResult? Function(_RebuildStats value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuildStats() when $default != null:
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
            int? frameNumber, int? startTime, List<RebuiltWidget> widgets)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _RebuildStats() when $default != null:
        return $default(_that.frameNumber, _that.startTime, _that.widgets);
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
            int? frameNumber, int? startTime, List<RebuiltWidget> widgets)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuildStats():
        return $default(_that.frameNumber, _that.startTime, _that.widgets);
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
            int? frameNumber, int? startTime, List<RebuiltWidget> widgets)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuildStats() when $default != null:
        return $default(_that.frameNumber, _that.startTime, _that.widgets);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _RebuildStats implements RebuildStats {
  const _RebuildStats(
      {required this.frameNumber,
      required this.startTime,
      required final List<RebuiltWidget> widgets})
      : _widgets = widgets;
  factory _RebuildStats.fromJson(Map<String, dynamic> json) =>
      _$RebuildStatsFromJson(json);

  @override
  final int? frameNumber;
  @override
  final int? startTime;
  final List<RebuiltWidget> _widgets;
  @override
  List<RebuiltWidget> get widgets {
    if (_widgets is EqualUnmodifiableListView) return _widgets;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_widgets);
  }

  /// Create a copy of RebuildStats
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$RebuildStatsCopyWith<_RebuildStats> get copyWith =>
      __$RebuildStatsCopyWithImpl<_RebuildStats>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$RebuildStatsToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _RebuildStats &&
            (identical(other.frameNumber, frameNumber) ||
                other.frameNumber == frameNumber) &&
            (identical(other.startTime, startTime) ||
                other.startTime == startTime) &&
            const DeepCollectionEquality().equals(other._widgets, _widgets));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, frameNumber, startTime,
      const DeepCollectionEquality().hash(_widgets));

  @override
  String toString() {
    return 'RebuildStats(frameNumber: $frameNumber, startTime: $startTime, widgets: $widgets)';
  }
}

/// @nodoc
abstract mixin class _$RebuildStatsCopyWith<$Res>
    implements $RebuildStatsCopyWith<$Res> {
  factory _$RebuildStatsCopyWith(
          _RebuildStats value, $Res Function(_RebuildStats) _then) =
      __$RebuildStatsCopyWithImpl;
  @override
  @useResult
  $Res call({int? frameNumber, int? startTime, List<RebuiltWidget> widgets});
}

/// @nodoc
class __$RebuildStatsCopyWithImpl<$Res>
    implements _$RebuildStatsCopyWith<$Res> {
  __$RebuildStatsCopyWithImpl(this._self, this._then);

  final _RebuildStats _self;
  final $Res Function(_RebuildStats) _then;

  /// Create a copy of RebuildStats
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? frameNumber = freezed,
    Object? startTime = freezed,
    Object? widgets = null,
  }) {
    return _then(_RebuildStats(
      frameNumber: freezed == frameNumber
          ? _self.frameNumber
          : frameNumber // ignore: cast_nullable_to_non_nullable
              as int?,
      startTime: freezed == startTime
          ? _self.startTime
          : startTime // ignore: cast_nullable_to_non_nullable
              as int?,
      widgets: null == widgets
          ? _self._widgets
          : widgets // ignore: cast_nullable_to_non_nullable
              as List<RebuiltWidget>,
    ));
  }
}

/// @nodoc
mixin _$RebuiltWidget {
  String get className;
  CreationLocation get location;
  int get count;

  /// Create a copy of RebuiltWidget
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $RebuiltWidgetCopyWith<RebuiltWidget> get copyWith =>
      _$RebuiltWidgetCopyWithImpl<RebuiltWidget>(
          this as RebuiltWidget, _$identity);

  /// Serializes this RebuiltWidget to a JSON map.
  Map<String, dynamic> toJson();

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is RebuiltWidget &&
            (identical(other.className, className) ||
                other.className == className) &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.count, count) || other.count == count));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, className, location, count);

  @override
  String toString() {
    return 'RebuiltWidget(className: $className, location: $location, count: $count)';
  }
}

/// @nodoc
abstract mixin class $RebuiltWidgetCopyWith<$Res> {
  factory $RebuiltWidgetCopyWith(
          RebuiltWidget value, $Res Function(RebuiltWidget) _then) =
      _$RebuiltWidgetCopyWithImpl;
  @useResult
  $Res call({String className, CreationLocation location, int count});

  $CreationLocationCopyWith<$Res> get location;
}

/// @nodoc
class _$RebuiltWidgetCopyWithImpl<$Res>
    implements $RebuiltWidgetCopyWith<$Res> {
  _$RebuiltWidgetCopyWithImpl(this._self, this._then);

  final RebuiltWidget _self;
  final $Res Function(RebuiltWidget) _then;

  /// Create a copy of RebuiltWidget
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? className = null,
    Object? location = null,
    Object? count = null,
  }) {
    return _then(_self.copyWith(
      className: null == className
          ? _self.className
          : className // ignore: cast_nullable_to_non_nullable
              as String,
      location: null == location
          ? _self.location
          : location // ignore: cast_nullable_to_non_nullable
              as CreationLocation,
      count: null == count
          ? _self.count
          : count // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }

  /// Create a copy of RebuiltWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $CreationLocationCopyWith<$Res> get location {
    return $CreationLocationCopyWith<$Res>(_self.location, (value) {
      return _then(_self.copyWith(location: value));
    });
  }
}

/// Adds pattern-matching-related methods to [RebuiltWidget].
extension RebuiltWidgetPatterns on RebuiltWidget {
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
    TResult Function(_RebuiltWidget value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _RebuiltWidget() when $default != null:
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
    TResult Function(_RebuiltWidget value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuiltWidget():
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
    TResult? Function(_RebuiltWidget value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuiltWidget() when $default != null:
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
    TResult Function(String className, CreationLocation location, int count)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _RebuiltWidget() when $default != null:
        return $default(_that.className, _that.location, _that.count);
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
    TResult Function(String className, CreationLocation location, int count)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuiltWidget():
        return $default(_that.className, _that.location, _that.count);
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
    TResult? Function(String className, CreationLocation location, int count)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _RebuiltWidget() when $default != null:
        return $default(_that.className, _that.location, _that.count);
      case _:
        return null;
    }
  }
}

/// @nodoc
@JsonSerializable()
class _RebuiltWidget implements RebuiltWidget {
  const _RebuiltWidget(
      {required this.className, required this.location, required this.count});
  factory _RebuiltWidget.fromJson(Map<String, dynamic> json) =>
      _$RebuiltWidgetFromJson(json);

  @override
  final String className;
  @override
  final CreationLocation location;
  @override
  final int count;

  /// Create a copy of RebuiltWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$RebuiltWidgetCopyWith<_RebuiltWidget> get copyWith =>
      __$RebuiltWidgetCopyWithImpl<_RebuiltWidget>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$RebuiltWidgetToJson(
      this,
    );
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _RebuiltWidget &&
            (identical(other.className, className) ||
                other.className == className) &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.count, count) || other.count == count));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, className, location, count);

  @override
  String toString() {
    return 'RebuiltWidget(className: $className, location: $location, count: $count)';
  }
}

/// @nodoc
abstract mixin class _$RebuiltWidgetCopyWith<$Res>
    implements $RebuiltWidgetCopyWith<$Res> {
  factory _$RebuiltWidgetCopyWith(
          _RebuiltWidget value, $Res Function(_RebuiltWidget) _then) =
      __$RebuiltWidgetCopyWithImpl;
  @override
  @useResult
  $Res call({String className, CreationLocation location, int count});

  @override
  $CreationLocationCopyWith<$Res> get location;
}

/// @nodoc
class __$RebuiltWidgetCopyWithImpl<$Res>
    implements _$RebuiltWidgetCopyWith<$Res> {
  __$RebuiltWidgetCopyWithImpl(this._self, this._then);

  final _RebuiltWidget _self;
  final $Res Function(_RebuiltWidget) _then;

  /// Create a copy of RebuiltWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? className = null,
    Object? location = null,
    Object? count = null,
  }) {
    return _then(_RebuiltWidget(
      className: null == className
          ? _self.className
          : className // ignore: cast_nullable_to_non_nullable
              as String,
      location: null == location
          ? _self.location
          : location // ignore: cast_nullable_to_non_nullable
              as CreationLocation,
      count: null == count
          ? _self.count
          : count // ignore: cast_nullable_to_non_nullable
              as int,
    ));
  }

  /// Create a copy of RebuiltWidget
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $CreationLocationCopyWith<$Res> get location {
    return $CreationLocationCopyWith<$Res>(_self.location, (value) {
      return _then(_self.copyWith(location: value));
    });
  }
}

// dart format on
