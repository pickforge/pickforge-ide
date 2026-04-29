import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';

@injectable
class DevicePickerCubit extends Cubit<DevicePickerState> {
  DevicePickerCubit(this._discovery) : super(const DevicePickerState.initial());

  final DeviceDiscoveryService _discovery;

  Future<void> refresh() async {
    emit(const DevicePickerState.loading());
    try {
      final snapshot = await _discovery.snapshot();
      emit(DevicePickerState.loaded(
        avds: snapshot.avds,
        running: snapshot.running,
      ));
    } on Object catch (e) {
      emit(DevicePickerState.error(e.toString()));
    }
  }
}
