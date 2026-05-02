// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'emulator_binding.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$EmulatorBinding {
  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType && other is EmulatorBinding);
  }

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() {
    return 'EmulatorBinding()';
  }
}

/// @nodoc
class $EmulatorBindingCopyWith<$Res> {
  $EmulatorBindingCopyWith(
      EmulatorBinding _, $Res Function(EmulatorBinding) __);
}

/// Adds pattern-matching-related methods to [EmulatorBinding].
extension EmulatorBindingPatterns on EmulatorBinding {
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
    TResult Function(AvdBinding value)? avd,
    TResult Function(ManualBinding value)? manual,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that);
      case ManualBinding() when manual != null:
        return manual(_that);
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
    required TResult Function(AvdBinding value) avd,
    required TResult Function(ManualBinding value) manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding():
        return avd(_that);
      case ManualBinding():
        return manual(_that);
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
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(AvdBinding value)? avd,
    TResult? Function(ManualBinding value)? manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that);
      case ManualBinding() when manual != null:
        return manual(_that);
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
    TResult Function(String avdId, String avdName, bool autoBootOnSelect)? avd,
    TResult Function(String vmServiceUrl)? manual,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that.avdId, _that.avdName, _that.autoBootOnSelect);
      case ManualBinding() when manual != null:
        return manual(_that.vmServiceUrl);
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
    required TResult Function(
            String avdId, String avdName, bool autoBootOnSelect)
        avd,
    required TResult Function(String vmServiceUrl) manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding():
        return avd(_that.avdId, _that.avdName, _that.autoBootOnSelect);
      case ManualBinding():
        return manual(_that.vmServiceUrl);
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
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String avdId, String avdName, bool autoBootOnSelect)? avd,
    TResult? Function(String vmServiceUrl)? manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that.avdId, _that.avdName, _that.autoBootOnSelect);
      case ManualBinding() when manual != null:
        return manual(_that.vmServiceUrl);
      case _:
        return null;
    }
  }
}

/// @nodoc

class AvdBinding implements EmulatorBinding {
  const AvdBinding(
      {required this.avdId,
      required this.avdName,
      this.autoBootOnSelect = true});

  final String avdId;
  final String avdName;
  @JsonKey()
  final bool autoBootOnSelect;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $AvdBindingCopyWith<AvdBinding> get copyWith =>
      _$AvdBindingCopyWithImpl<AvdBinding>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is AvdBinding &&
            (identical(other.avdId, avdId) || other.avdId == avdId) &&
            (identical(other.avdName, avdName) || other.avdName == avdName) &&
            (identical(other.autoBootOnSelect, autoBootOnSelect) ||
                other.autoBootOnSelect == autoBootOnSelect));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, avdId, avdName, autoBootOnSelect);

  @override
  String toString() {
    return 'EmulatorBinding.avd(avdId: $avdId, avdName: $avdName, autoBootOnSelect: $autoBootOnSelect)';
  }
}

/// @nodoc
abstract mixin class $AvdBindingCopyWith<$Res>
    implements $EmulatorBindingCopyWith<$Res> {
  factory $AvdBindingCopyWith(
          AvdBinding value, $Res Function(AvdBinding) _then) =
      _$AvdBindingCopyWithImpl;
  @useResult
  $Res call({String avdId, String avdName, bool autoBootOnSelect});
}

/// @nodoc
class _$AvdBindingCopyWithImpl<$Res> implements $AvdBindingCopyWith<$Res> {
  _$AvdBindingCopyWithImpl(this._self, this._then);

  final AvdBinding _self;
  final $Res Function(AvdBinding) _then;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? avdId = null,
    Object? avdName = null,
    Object? autoBootOnSelect = null,
  }) {
    return _then(AvdBinding(
      avdId: null == avdId
          ? _self.avdId
          : avdId // ignore: cast_nullable_to_non_nullable
              as String,
      avdName: null == avdName
          ? _self.avdName
          : avdName // ignore: cast_nullable_to_non_nullable
              as String,
      autoBootOnSelect: null == autoBootOnSelect
          ? _self.autoBootOnSelect
          : autoBootOnSelect // ignore: cast_nullable_to_non_nullable
              as bool,
    ));
  }
}

/// @nodoc

class ManualBinding implements EmulatorBinding {
  const ManualBinding({required this.vmServiceUrl});

  final String vmServiceUrl;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $ManualBindingCopyWith<ManualBinding> get copyWith =>
      _$ManualBindingCopyWithImpl<ManualBinding>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is ManualBinding &&
            (identical(other.vmServiceUrl, vmServiceUrl) ||
                other.vmServiceUrl == vmServiceUrl));
  }

  @override
  int get hashCode => Object.hash(runtimeType, vmServiceUrl);

  @override
  String toString() {
    return 'EmulatorBinding.manual(vmServiceUrl: $vmServiceUrl)';
  }
}

/// @nodoc
abstract mixin class $ManualBindingCopyWith<$Res>
    implements $EmulatorBindingCopyWith<$Res> {
  factory $ManualBindingCopyWith(
          ManualBinding value, $Res Function(ManualBinding) _then) =
      _$ManualBindingCopyWithImpl;
  @useResult
  $Res call({String vmServiceUrl});
}

/// @nodoc
class _$ManualBindingCopyWithImpl<$Res>
    implements $ManualBindingCopyWith<$Res> {
  _$ManualBindingCopyWithImpl(this._self, this._then);

  final ManualBinding _self;
  final $Res Function(ManualBinding) _then;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? vmServiceUrl = null,
  }) {
    return _then(ManualBinding(
      vmServiceUrl: null == vmServiceUrl
          ? _self.vmServiceUrl
          : vmServiceUrl // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

// dart format on
