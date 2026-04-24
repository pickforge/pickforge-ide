import 'dart:async';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/vm_service/reconnect_policy.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart' as vm_io;

typedef VmServiceFactory = Future<VmService> Function(String url);
typedef VmServiceDelay = Future<void> Function(Duration duration);

@lazySingleton
class VmServiceClient {
  VmServiceClient()
      : _factory = vm_io.vmServiceConnectUri,
        _delay = Future<void>.delayed;

  VmServiceClient.forTesting({
    required VmServiceFactory factory,
    VmServiceDelay? delay,
  })  : _factory = factory,
        _delay = delay ?? Future<void>.delayed;

  final VmServiceFactory _factory;
  final VmServiceDelay _delay;
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
      final nextService = await _factory(url);
      await _replaceService(nextService);
      _controller.add(VmServiceConnectionState.connected(url: url));
    } on Object catch (e) {
      await _clearService();
      _controller.add(
        VmServiceConnectionState.error(message: e.toString(), attempt: 1),
      );
      rethrow;
    }
  }

  Future<void> reconnectLoop(
    String url, {
    required ExponentialBackoff policy,
    int maxAttempts = 1 << 30,
  }) async {
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      _controller.add(VmServiceConnectionState.connecting(attempt: attempt));
      try {
        final nextService = await _factory(url);
        _url = url;
        await _replaceService(nextService);
        _controller.add(VmServiceConnectionState.connected(url: url));
        return;
      } on Object catch (e) {
        await _clearService();
        _controller.add(
          VmServiceConnectionState.error(
            message: e.toString(),
            attempt: attempt,
          ),
        );
        if (attempt == maxAttempts) return;
        await _delay(policy.delayFor(attempt));
      }
    }
  }

  Future<void> disconnect() async {
    await _clearService();
    _controller.add(const VmServiceConnectionState.idle());
  }

  Future<void> close() async {
    await disconnect();
    await _controller.close();
  }

  Future<void> _replaceService(VmService nextService) async {
    final previous = _service;
    if (!identical(previous, nextService)) {
      await previous?.dispose();
    }
    _service = nextService;
  }

  Future<void> _clearService() async {
    final previous = _service;
    _service = null;
    await previous?.dispose();
  }
}
