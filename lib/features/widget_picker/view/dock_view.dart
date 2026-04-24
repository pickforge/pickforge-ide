import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/selection_stream.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/forge/forge.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:vm_service/vm_service.dart';

class DockView extends StatefulWidget {
  const DockView({super.key, this.cubit});

  final WidgetPickerCubit? cubit;

  @override
  State<DockView> createState() => _DockViewState();
}

class _DockViewState extends State<DockView> {
  WidgetPickerCubit? _cubit;

  @override
  void initState() {
    super.initState();
    _initCubit();
  }

  void _initCubit() {
    if (widget.cubit != null) {
      _cubit = widget.cubit;
      return;
    }
    final vm = getIt<VmServiceClient>();
    if (vm.service != null) {
      _createInspectorAndCubit(vm.service!);
      return;
    }

    late final StreamSubscription<VmService> sub;
    sub = vm.serviceStream.listen(
      (service) {
        if (mounted) {
          _createInspectorAndCubit(service);
          if (mounted) setState(() {});
        }
        unawaited(sub.cancel());
      },
      onError: (_) => unawaited(sub.cancel()),
      onDone: () => unawaited(sub.cancel()),
    );
  }

  void _createInspectorAndCubit(VmService service) {
    if (_cubit != null) return;
    final inspector = InspectorExtensions(service, isolateId: 'isolates/1');
    final repo = InspectorRepository(inspector, const SourceSnippetExtractor());
    final stream = SelectionStream(repo);
    _cubit = WidgetPickerCubit(repo, stream);
    unawaited(_cubit!.startListening());
  }

  @override
  void dispose() {
    if (widget.cubit == null) unawaited(_cubit?.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_cubit == null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.developer_board_outlined, size: 48),
              const SizedBox(height: 16),
              Text(
                'Connecting to VM Service...',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      );
    }

    return BlocProvider.value(
      value: _cubit!,
      child: BlocBuilder<WidgetPickerCubit, WidgetPickerState>(
        builder: (context, state) {
          final sel = state.selection;
          return Column(
            children: [
              Expanded(
                child: AnimatedSwitcher(
                  duration: PickforgeMotion.standard,
                  switchInCurve: PickforgeMotion.curveOut,
                  switchOutCurve: PickforgeMotion.curveOut,
                  child: sel == null
                      ? const NoSelectionPlaceholder(key: ValueKey('empty'))
                      : WidgetDetailsPanel(
                          key: ValueKey(sel.node.id),
                          selected: sel,
                        ),
                ),
              ),
              ForgePanel(
                selection: sel,
                projectRoot: Directory.current.path,
              ),
            ],
          );
        },
      ),
    );
  }
}
