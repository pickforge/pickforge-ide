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
    TResult Function(PhysicalDeviceBinding value)? physical,
    TResult Function(IosSimulatorBinding value)? iosSimulator,
    TResult Function(WebTargetBinding value)? webTarget,
    TResult Function(ManualBinding value)? manual,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that);
      case PhysicalDeviceBinding() when physical != null:
        return physical(_that);
      case IosSimulatorBinding() when iosSimulator != null:
        return iosSimulator(_that);
      case WebTargetBinding() when webTarget != null:
        return webTarget(_that);
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
    required TResult Function(PhysicalDeviceBinding value) physical,
    required TResult Function(IosSimulatorBinding value) iosSimulator,
    required TResult Function(WebTargetBinding value) webTarget,
    required TResult Function(ManualBinding value) manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding():
        return avd(_that);
      case PhysicalDeviceBinding():
        return physical(_that);
      case IosSimulatorBinding():
        return iosSimulator(_that);
      case WebTargetBinding():
        return webTarget(_that);
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
    TResult? Function(PhysicalDeviceBinding value)? physical,
    TResult? Function(IosSimulatorBinding value)? iosSimulator,
    TResult? Function(WebTargetBinding value)? webTarget,
    TResult? Function(ManualBinding value)? manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that);
      case PhysicalDeviceBinding() when physical != null:
        return physical(_that);
      case IosSimulatorBinding() when iosSimulator != null:
        return iosSimulator(_that);
      case WebTargetBinding() when webTarget != null:
        return webTarget(_that);
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
    TResult Function(String serial, String name)? physical,
    TResult Function(String simulatorId, String name)? iosSimulator,
    TResult Function(String targetId, String name)? webTarget,
    TResult Function(String vmServiceUrl)? manual,
    required TResult orElse(),
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that.avdId, _that.avdName, _that.autoBootOnSelect);
      case PhysicalDeviceBinding() when physical != null:
        return physical(_that.serial, _that.name);
      case IosSimulatorBinding() when iosSimulator != null:
        return iosSimulator(_that.simulatorId, _that.name);
      case WebTargetBinding() when webTarget != null:
        return webTarget(_that.targetId, _that.name);
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
    required TResult Function(String serial, String name) physical,
    required TResult Function(String simulatorId, String name) iosSimulator,
    required TResult Function(String targetId, String name) webTarget,
    required TResult Function(String vmServiceUrl) manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding():
        return avd(_that.avdId, _that.avdName, _that.autoBootOnSelect);
      case PhysicalDeviceBinding():
        return physical(_that.serial, _that.name);
      case IosSimulatorBinding():
        return iosSimulator(_that.simulatorId, _that.name);
      case WebTargetBinding():
        return webTarget(_that.targetId, _that.name);
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
    TResult? Function(String serial, String name)? physical,
    TResult? Function(String simulatorId, String name)? iosSimulator,
    TResult? Function(String targetId, String name)? webTarget,
    TResult? Function(String vmServiceUrl)? manual,
  }) {
    final _that = this;
    switch (_that) {
      case AvdBinding() when avd != null:
        return avd(_that.avdId, _that.avdName, _that.autoBootOnSelect);
      case PhysicalDeviceBinding() when physical != null:
        return physical(_that.serial, _that.name);
      case IosSimulatorBinding() when iosSimulator != null:
        return iosSimulator(_that.simulatorId, _that.name);
      case WebTargetBinding() when webTarget != null:
        return webTarget(_that.targetId, _that.name);
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

class PhysicalDeviceBinding implements EmulatorBinding {
  const PhysicalDeviceBinding({required this.serial, required this.name});

  final String serial;
  final String name;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $PhysicalDeviceBindingCopyWith<PhysicalDeviceBinding> get copyWith =>
      _$PhysicalDeviceBindingCopyWithImpl<PhysicalDeviceBinding>(
          this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is PhysicalDeviceBinding &&
            (identical(other.serial, serial) || other.serial == serial) &&
            (identical(other.name, name) || other.name == name));
  }

  @override
  int get hashCode => Object.hash(runtimeType, serial, name);

  @override
  String toString() {
    return 'EmulatorBinding.physical(serial: $serial, name: $name)';
  }
}

/// @nodoc
abstract mixin class $PhysicalDeviceBindingCopyWith<$Res>
    implements $EmulatorBindingCopyWith<$Res> {
  factory $PhysicalDeviceBindingCopyWith(PhysicalDeviceBinding value,
          $Res Function(PhysicalDeviceBinding) _then) =
      _$PhysicalDeviceBindingCopyWithImpl;
  @useResult
  $Res call({String serial, String name});
}

/// @nodoc
class _$PhysicalDeviceBindingCopyWithImpl<$Res>
    implements $PhysicalDeviceBindingCopyWith<$Res> {
  _$PhysicalDeviceBindingCopyWithImpl(this._self, this._then);

  final PhysicalDeviceBinding _self;
  final $Res Function(PhysicalDeviceBinding) _then;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? serial = null,
    Object? name = null,
  }) {
    return _then(PhysicalDeviceBinding(
      serial: null == serial
          ? _self.serial
          : serial // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class IosSimulatorBinding implements EmulatorBinding {
  const IosSimulatorBinding({required this.simulatorId, required this.name});

  final String simulatorId;
  final String name;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $IosSimulatorBindingCopyWith<IosSimulatorBinding> get copyWith =>
      _$IosSimulatorBindingCopyWithImpl<IosSimulatorBinding>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is IosSimulatorBinding &&
            (identical(other.simulatorId, simulatorId) ||
                other.simulatorId == simulatorId) &&
            (identical(other.name, name) || other.name == name));
  }

  @override
  int get hashCode => Object.hash(runtimeType, simulatorId, name);

  @override
  String toString() {
    return 'EmulatorBinding.iosSimulator(simulatorId: $simulatorId, name: $name)';
  }
}

/// @nodoc
abstract mixin class $IosSimulatorBindingCopyWith<$Res>
    implements $EmulatorBindingCopyWith<$Res> {
  factory $IosSimulatorBindingCopyWith(
          IosSimulatorBinding value, $Res Function(IosSimulatorBinding) _then) =
      _$IosSimulatorBindingCopyWithImpl;
  @useResult
  $Res call({String simulatorId, String name});
}

/// @nodoc
class _$IosSimulatorBindingCopyWithImpl<$Res>
    implements $IosSimulatorBindingCopyWith<$Res> {
  _$IosSimulatorBindingCopyWithImpl(this._self, this._then);

  final IosSimulatorBinding _self;
  final $Res Function(IosSimulatorBinding) _then;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? simulatorId = null,
    Object? name = null,
  }) {
    return _then(IosSimulatorBinding(
      simulatorId: null == simulatorId
          ? _self.simulatorId
          : simulatorId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc

class WebTargetBinding implements EmulatorBinding {
  const WebTargetBinding({required this.targetId, required this.name});

  final String targetId;
  final String name;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @pragma('vm:prefer-inline')
  $WebTargetBindingCopyWith<WebTargetBinding> get copyWith =>
      _$WebTargetBindingCopyWithImpl<WebTargetBinding>(this, _$identity);

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is WebTargetBinding &&
            (identical(other.targetId, targetId) ||
                other.targetId == targetId) &&
            (identical(other.name, name) || other.name == name));
  }

  @override
  int get hashCode => Object.hash(runtimeType, targetId, name);

  @override
  String toString() {
    return 'EmulatorBinding.webTarget(targetId: $targetId, name: $name)';
  }
}

/// @nodoc
abstract mixin class $WebTargetBindingCopyWith<$Res>
    implements $EmulatorBindingCopyWith<$Res> {
  factory $WebTargetBindingCopyWith(
          WebTargetBinding value, $Res Function(WebTargetBinding) _then) =
      _$WebTargetBindingCopyWithImpl;
  @useResult
  $Res call({String targetId, String name});
}

/// @nodoc
class _$WebTargetBindingCopyWithImpl<$Res>
    implements $WebTargetBindingCopyWith<$Res> {
  _$WebTargetBindingCopyWithImpl(this._self, this._then);

  final WebTargetBinding _self;
  final $Res Function(WebTargetBinding) _then;

  /// Create a copy of EmulatorBinding
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  $Res call({
    Object? targetId = null,
    Object? name = null,
  }) {
    return _then(WebTargetBinding(
      targetId: null == targetId
          ? _self.targetId
          : targetId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _self.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
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
