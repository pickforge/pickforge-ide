import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/selection_stream.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_cubit.dart';
import 'package:vm_service/vm_service.dart';

class WidgetPickerScope extends StatefulWidget {
  const WidgetPickerScope({
    required this.child,
    this.projectRoot,
    this.vmClient,
    this.ipcServer,
    this.inspectorVisible = true,
    super.key,
  });

  final Widget child;
  final String? projectRoot;
  final VmServiceClient? vmClient;
  final EmulatorIpcServer? ipcServer;
  final bool inspectorVisible;

  @override
  State<WidgetPickerScope> createState() => _WidgetPickerScopeState();
}

class _WidgetPickerScopeState extends State<WidgetPickerScope> {
  StreamSubscription<VmService>? _serviceSub;
  StreamSubscription<VmServiceConnectionState>? _stateSub;
  WidgetPickerCubit? _cubit;
  int _generation = 0;

  VmServiceClient get _vmClient => widget.vmClient ?? getIt<VmServiceClient>();

  @override
  void initState() {
    super.initState();
    _bindSelectionProvider();
    _listen();
  }

  @override
  void didUpdateWidget(covariant WidgetPickerScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.ipcServer, widget.ipcServer)) {
      oldWidget.ipcServer?.bindSelectionProvider(null);
      _bindSelectionProvider();
    }
    if (!identical(oldWidget.vmClient, widget.vmClient) ||
        oldWidget.projectRoot != widget.projectRoot) {
      _generation++;
      unawaited(_serviceSub?.cancel());
      unawaited(_stateSub?.cancel());
      unawaited(_replaceCubit(null));
      _listen();
      return;
    }
    if (oldWidget.inspectorVisible != widget.inspectorVisible) {
      _syncCubitVisibility();
    }
  }

  @override
  void dispose() {
    _generation++;
    unawaited(_serviceSub?.cancel());
    unawaited(_stateSub?.cancel());
    widget.ipcServer?.bindSelectionProvider(null);
    unawaited(_cubit?.close());
    super.dispose();
  }

  void _bindSelectionProvider() {
    widget.ipcServer?.bindSelectionProvider(
      () => _cubit?.state.selection?.toJson(),
    );
  }

  void _listen() {
    final vmClient = _vmClient;
    _serviceSub = vmClient.serviceStream.listen((s) => unawaited(_attach(s)));
    _stateSub = vmClient.state.listen(_onVmState);
  }

  void _onVmState(VmServiceConnectionState state) {
    state.maybeWhen(
      connected: (_) {},
      orElse: () {
        _generation++;
        unawaited(_replaceCubit(null));
      },
    );
  }

  Future<void> _attach(VmService service) async {
    final generation = ++_generation;
    try {
      final vm = await service.getVM();
      if (!mounted || generation != _generation) return;
      final isolateId = _firstIsolateId(vm);
      if (isolateId == null) {
        await _replaceCubit(null);
        return;
      }

      final repo = InspectorRepository(
        InspectorExtensions(service, isolateId: isolateId),
        const SourceSnippetExtractor(),
        projectRoot: widget.projectRoot,
      );
      final cubit = WidgetPickerCubit(repo, SelectionStream(repo));
      await _replaceCubit(cubit);
      _syncCubitVisibility();
    } on Object {
      if (mounted && generation == _generation) {
        await _replaceCubit(null);
      }
    }
  }

  String? _firstIsolateId(VM vm) {
    final isolates = vm.isolates ?? const [];
    for (final isolate in isolates) {
      final id = isolate.id;
      if (id != null) return id;
    }
    return null;
  }

  void _syncCubitVisibility() {
    final cubit = _cubit;
    if (cubit == null) return;
    final generation = _generation;
    if (widget.inspectorVisible) {
      unawaited(_startCubit(cubit, generation));
    } else {
      unawaited(cubit.pauseListening());
    }
  }

  Future<void> _startCubit(WidgetPickerCubit cubit, int generation) async {
    if (!mounted || generation != _generation || !widget.inspectorVisible) {
      return;
    }
    try {
      await cubit.startListening();
    } on Object {
      if (!mounted || generation != _generation || !identical(_cubit, cubit)) {
        return;
      }
      await _replaceCubit(null);
    }
  }

  Future<void> _replaceCubit(WidgetPickerCubit? next) async {
    final previous = _cubit;
    if (mounted) setState(() => _cubit = next);
    if (!identical(previous, next)) await previous?.close();
  }

  @override
  Widget build(BuildContext context) {
    final cubit = _cubit;
    if (cubit == null) return widget.child;
    return BlocProvider.value(value: cubit, child: widget.child);
  }
}
