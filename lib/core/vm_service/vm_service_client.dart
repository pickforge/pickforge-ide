import 'dart:async';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart' as vm_io;

typedef VmServiceFactory = Future<VmService> Function(String url);

@lazySingleton
class VmServiceClient {
  VmServiceClient() : _factory = vm_io.vmServiceConnectUri;

  VmServiceClient.forTesting({required VmServiceFactory factory})
      : _factory = factory;

  final VmServiceFactory _factory;
  final _controller = StreamController<VmServiceConnectionState>.broadcast();

  VmService? _service;
  String? _url;

  Stream<VmServiceConnectionState> get state => _controller.stream;
  VmService? get service => _service;
  String? get currentUrl => _url;

  Future<void> connect(String url) async {
    _url = url;
    _controller.add(const VmServiceConnectionState.connecting(attempt: 1));
    try {
      _service = await _factory(url);
      _controller.add(VmServiceConnectionState.connected(url: url));
    } on Object catch (e) {
      _controller.add(
        VmServiceConnectionState.error(message: e.toString(), attempt: 1),
      );
      rethrow;
    }
  }

  Future<void> disconnect() async {
    await _service?.dispose();
    _service = null;
    _controller.add(const VmServiceConnectionState.idle());
  }

  Future<void> close() async {
    await disconnect();
    await _controller.close();
  }
}
