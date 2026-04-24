import 'package:bloc/bloc.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/connection/bloc/connection_event.dart';
import 'package:pickforge/features/connection/bloc/connection_state.dart';

/// Manages VM Service connection lifecycle.
///
/// NOT DI-registered because `InspectorRepository` is not in DI
/// (requires live `VmService` for `InspectorExtensions`).
class ConnectionBloc extends Bloc<ConnectionEvent, ConnectionState> {
  ConnectionBloc(
    this._vmClient,
    this._settings,
  ) : super(const ConnectionState.idle()) {
    on<ConnectionEvent>(
      (event, emit) => event.map(
        bootstrap: (e) => _onBootstrap(e.projectRoot, emit),
        connectPressed: (e) => _onConnect(e.url, emit),
        disconnectPressed: (_) => _onDisconnect(emit),
      ),
    );
  }

  final VmServiceClient _vmClient;
  final ProjectSettingsRepository _settings;
  String? _currentProjectRoot;

  Future<void> _onBootstrap(
    String projectRoot,
    Emitter<ConnectionState> emit,
  ) async {
    _currentProjectRoot = projectRoot;
    final saved = await _settings.getVmServiceUrl(projectRoot);
    emit(ConnectionState.idle(savedUrl: saved));
  }

  Future<void> _onConnect(
    String url,
    Emitter<ConnectionState> emit,
  ) async {
    emit(ConnectionState.connecting(url: url));
    try {
      await _vmClient.connect(url);
      await _settings.setVmServiceUrl(_currentProjectRoot ?? '', url);
      emit(ConnectionState.connected(url: url));
    } on Object catch (e) {
      emit(ConnectionState.error(url: url, message: e.toString()));
    }
  }

  Future<void> _onDisconnect(Emitter<ConnectionState> emit) async {
    await _vmClient.disconnect();
    final saved = _currentProjectRoot == null
        ? null
        : await _settings.getVmServiceUrl(_currentProjectRoot!);
    emit(ConnectionState.idle(savedUrl: saved));
  }
}
