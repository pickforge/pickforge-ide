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

class DockView extends StatefulWidget {
  const DockView({super.key, this.cubit});

  final WidgetPickerCubit? cubit;

  @override
  State<DockView> createState() => _DockViewState();
}

class _DockViewState extends State<DockView> {
  late WidgetPickerCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = widget.cubit ?? _buildCubit();
  }

  WidgetPickerCubit _buildCubit() {
    final vm = getIt<VmServiceClient>();
    final inspector = InspectorExtensions(vm.service!, isolateId: 'isolates/1');
    final repo = InspectorRepository(inspector, const SourceSnippetExtractor());
    final stream = SelectionStream(repo);
    final cubit = WidgetPickerCubit(repo, stream);
    unawaited(cubit.startListening());
    return cubit;
  }

  @override
  void dispose() {
    if (widget.cubit == null) unawaited(_cubit.close());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: BlocBuilder<WidgetPickerCubit, WidgetPickerState>(
        builder: (context, state) {
          final sel = state.selection;
          return Column(
            children: [
              Expanded(
                child: sel == null
                    ? const NoSelectionPlaceholder()
                    : WidgetDetailsPanel(selected: sel),
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
