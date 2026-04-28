import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';

class InspectorPanel extends StatelessWidget {
  const InspectorPanel({super.key, this.cubit});

  final WidgetPickerCubit? cubit;

  @override
  Widget build(BuildContext context) {
    if (cubit != null) {
      return BlocProvider.value(value: cubit!, child: const _Inner());
    }
    try {
      context.read<WidgetPickerCubit>();
    } on ProviderNotFoundException {
      return const _DisconnectedPlaceholder();
    }
    return const _Inner();
  }
}

class _Inner extends StatelessWidget {
  const _Inner();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WidgetPickerCubit, WidgetPickerState>(
      builder: (context, state) {
        final selection = state.selection;
        return ColoredBox(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _ConnectionPill(),
              const Divider(height: 1),
              Expanded(
                child: selection == null
                    ? const Center(child: Text('No widget selected'))
                    : WidgetDetailsPanel(selected: selection),
              ),
            ],
          ),
        );
      },
    );
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
          _ConnectionPill(),
          Divider(height: 1),
          Expanded(
            child: Center(child: Text('No widget picker connected')),
          ),
        ],
      ),
    );
  }
}

class _ConnectionPill extends StatelessWidget {
  const _ConnectionPill();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Icon(
            Icons.circle,
            size: 10,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(width: 8),
          const Text('Disconnected'),
        ],
      ),
    );
  }
}
