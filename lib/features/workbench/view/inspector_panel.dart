import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/history/pick_history_recorder.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/emulator/view/connection_pill.dart';
import 'package:pickforge/features/forge/forge.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

class InspectorPanel extends StatelessWidget {
  const InspectorPanel({super.key, this.cubit, this.historyRecorder});

  final WidgetPickerCubit? cubit;
  final PickHistoryRecorder? historyRecorder;

  @override
  Widget build(BuildContext context) {
    if (cubit != null) {
      return BlocProvider.value(
        value: cubit!,
        child: _Inner(historyRecorder: historyRecorder),
      );
    }
    try {
      context.read<WidgetPickerCubit>();
    } on ProviderNotFoundException {
      return const _DisconnectedPlaceholder();
    }
    return _Inner(historyRecorder: historyRecorder);
  }
}

class _Inner extends StatelessWidget {
  const _Inner({this.historyRecorder});

  final PickHistoryRecorder? historyRecorder;

  @override
  Widget build(BuildContext context) {
    final projectRoot = switch (context.watch<ProjectsCubit>().state) {
      ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
      _ => null,
    };
    final activeChat = switch (context.watch<ChatsCubit>().state) {
      ChatsReady(:final activeChat) => activeChat,
      _ => null,
    };
    final activeChatId =
        activeChat?.projectRoot == projectRoot ? activeChat?.chatId : null;

    return BlocListener<WidgetPickerCubit, WidgetPickerState>(
      listenWhen: (previous, current) =>
          previous.selection?.node.id != current.selection?.node.id &&
          current.selection != null,
      listener: (context, state) {
        final selection = state.selection;
        if (selection == null) return;
        final root = _activeProjectRoot(context);
        if (root == null) return;
        final recorder = historyRecorder ?? _historyRecorderOrNull();
        if (recorder == null) return;
        unawaited(
          _recordSelection(
            recorder: recorder,
            projectRoot: root,
            selection: selection,
            forgeState: _forgeStateOrInitial(context),
            chatId: _activeChatId(context, root),
          ),
        );
      },
      child: BlocBuilder<WidgetPickerCubit, WidgetPickerState>(
        builder: (context, state) {
          final selection = state.selection;
          return ColoredBox(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const ConnectionPill(),
                const Divider(height: 1),
                Expanded(
                  child: selection == null
                      ? const Center(child: Text('No widget selected'))
                      : WidgetDetailsPanel(selected: selection),
                ),
                if (projectRoot != null) ...[
                  const Divider(height: 1),
                  ForgePanel(
                    selection: selection,
                    projectRoot: projectRoot,
                    chatId: activeChatId,
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _recordSelection({
    required PickHistoryRecorder recorder,
    required String projectRoot,
    required SelectedWidget selection,
    required ForgeState forgeState,
    required String? chatId,
  }) async {
    try {
      await recorder.recordSelection(
        projectRoot: projectRoot,
        selection: selection,
        forgeState: forgeState,
        chatId: chatId,
      );
    } on Object {
      return;
    }
  }

  String? _activeProjectRoot(BuildContext context) {
    return switch (context.read<ProjectsCubit>().state) {
      ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
      _ => null,
    };
  }

  String? _activeChatId(BuildContext context, String projectRoot) {
    final activeChat = switch (context.read<ChatsCubit>().state) {
      ChatsReady(:final activeChat) => activeChat,
      _ => null,
    };
    return activeChat?.projectRoot == projectRoot ? activeChat?.chatId : null;
  }

  ForgeState _forgeStateOrInitial(BuildContext context) {
    try {
      return context.read<ForgeCubit>().state;
    } on ProviderNotFoundException {
      return ForgeState.initial();
    }
  }

  PickHistoryRecorder? _historyRecorderOrNull() {
    if (!getIt.isRegistered<PickforgeDatabase>()) return null;
    return PickHistoryRecorder(getIt<PickforgeDatabase>().pickHistoryDao);
  }
}

class _DisconnectedPlaceholder extends StatelessWidget {
  const _DisconnectedPlaceholder();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ConnectionPill(),
          Divider(height: 1),
          Expanded(
            child: Center(child: Text('No widget picker connected')),
          ),
        ],
      ),
    );
  }
}
