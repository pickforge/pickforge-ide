// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'widget_picker_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$WidgetPickerState {
  SelectedWidget? get selection;
  bool get selectModeEnabled;

  /// Create a copy of WidgetPickerState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $WidgetPickerStateCopyWith<WidgetPickerState> get copyWith =>
      _$WidgetPickerStateCopyWithImpl<WidgetPickerState>(
          this as WidgetPickerState, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is WidgetPickerState &&
            (identical(other.selection, selection) ||
                other.selection == selection) &&
            (identical(other.selectModeEnabled, selectModeEnabled) ||
                other.selectModeEnabled == selectModeEnabled));
  }

  @override
  int get hashCode => Object.hash(runtimeType, selection, selectModeEnabled);

  @override
  String toString() {
    return 'WidgetPickerState(selection: $selection, selectModeEnabled: $selectModeEnabled)';
  }
}

/// @nodoc
abstract mixin class $WidgetPickerStateCopyWith<$Res> {
  factory $WidgetPickerStateCopyWith(
          WidgetPickerState value, $Res Function(WidgetPickerState) _then) =
      _$WidgetPickerStateCopyWithImpl;
  @useResult
  $Res call({SelectedWidget? selection, bool selectModeEnabled});

  $SelectedWidgetCopyWith<$Res>? get selection;
}

/// @nodoc
class _$WidgetPickerStateCopyWithImpl<$Res>
    implements $WidgetPickerStateCopyWith<$Res> {
  _$WidgetPickerStateCopyWithImpl(this._self, this._then);

  final WidgetPickerState _self;
  final $Res Function(WidgetPickerState) _then;

  /// Create a copy of WidgetPickerState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? selection = freezed,
    Object? selectModeEnabled = null,
  }) {
    return _then(_self.copyWith(
      selection: freezed == selection
          ? _self.selection
          : selection // ignore: cast_nullable_to_non_nullable
              as SelectedWidget?,
      selectModeEnabled: null == selectModeEnabled
          ? _self.selectModeEnabled
          : selectModeEnabled // ignore: cast_nullable_to_non_nullable
              as bool,
    ));
  }

  /// Create a copy of WidgetPickerState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $SelectedWidgetCopyWith<$Res>? get selection {
    if (_self.selection == null) {
      return null;
    }

    return $SelectedWidgetCopyWith<$Res>(_self.selection!, (value) {
      return _then(_self.copyWith(selection: value));
    });
  }
}

/// Adds pattern-matching-related methods to [WidgetPickerState].
extension WidgetPickerStatePatterns on WidgetPickerState {
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
    TResult Function(_WidgetPickerState value)? $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _WidgetPickerState() when $default != null:
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
    TResult Function(_WidgetPickerState value) $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetPickerState():
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
    TResult? Function(_WidgetPickerState value)? $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetPickerState() when $default != null:
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
    TResult Function(SelectedWidget? selection, bool selectModeEnabled)?
        $default, {
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case _WidgetPickerState() when $default != null:
        return $default(_that.selection, _that.selectModeEnabled);
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
    TResult Function(SelectedWidget? selection, bool selectModeEnabled)
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetPickerState():
        return $default(_that.selection, _that.selectModeEnabled);
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
    TResult? Function(SelectedWidget? selection, bool selectModeEnabled)?
        $default,
  ) {
    final _that = this;
    switch (_that) {
      case _WidgetPickerState() when $default != null:
        return $default(_that.selection, _that.selectModeEnabled);
      case _:
        return null;
    }
  }
}

/// @nodoc

class _WidgetPickerState implements WidgetPickerState {
  const _WidgetPickerState(
      {required this.selection, required this.selectModeEnabled});

  @override
  final SelectedWidget? selection;
  @override
  final bool selectModeEnabled;

  /// Create a copy of WidgetPickerState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  _$WidgetPickerStateCopyWith<_WidgetPickerState> get copyWith =>
      __$WidgetPickerStateCopyWithImpl<_WidgetPickerState>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _WidgetPickerState &&
            (identical(other.selection, selection) ||
                other.selection == selection) &&
            (identical(other.selectModeEnabled, selectModeEnabled) ||
                other.selectModeEnabled == selectModeEnabled));
  }

  @override
  int get hashCode => Object.hash(runtimeType, selection, selectModeEnabled);

  @override
  String toString() {
    return 'WidgetPickerState(selection: $selection, selectModeEnabled: $selectModeEnabled)';
  }
}

/// @nodoc
abstract mixin class _$WidgetPickerStateCopyWith<$Res>
    implements $WidgetPickerStateCopyWith<$Res> {
  factory _$WidgetPickerStateCopyWith(
          _WidgetPickerState value, $Res Function(_WidgetPickerState) _then) =
      __$WidgetPickerStateCopyWithImpl;
  @override
  @useResult
  $Res call({SelectedWidget? selection, bool selectModeEnabled});

  @override
  $SelectedWidgetCopyWith<$Res>? get selection;
}

/// @nodoc
class __$WidgetPickerStateCopyWithImpl<$Res>
    implements _$WidgetPickerStateCopyWith<$Res> {
  __$WidgetPickerStateCopyWithImpl(this._self, this._then);

  final _WidgetPickerState _self;
  final $Res Function(_WidgetPickerState) _then;

  /// Create a copy of WidgetPickerState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $Res call({
    Object? selection = freezed,
    Object? selectModeEnabled = null,
  }) {
    return _then(_WidgetPickerState(
      selection: freezed == selection
          ? _self.selection
          : selection // ignore: cast_nullable_to_non_nullable
              as SelectedWidget?,
      selectModeEnabled: null == selectModeEnabled
          ? _self.selectModeEnabled
          : selectModeEnabled // ignore: cast_nullable_to_non_nullable
              as bool,
    ));
  }

  /// Create a copy of WidgetPickerState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $SelectedWidgetCopyWith<$Res>? get selection {
    if (_self.selection == null) {
      return null;
    }

    return $SelectedWidgetCopyWith<$Res>(_self.selection!, (value) {
      return _then(_self.copyWith(selection: value));
    });
  }
}

// dart format on
