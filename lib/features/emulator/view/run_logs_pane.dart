import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class RunLogsPane extends StatelessWidget {
  const RunLogsPane({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _FilterBar(),
        const Divider(height: 1),
        Expanded(
          child: BlocBuilder<RunLogsCubit, RunLogsState>(
            builder: (context, state) {
              final visible = state.visibleEntries;
              if (visible.isEmpty) {
                return Center(
                  child: Text(AppLocalizations.of(context).runLogsEmpty),
                );
              }
              return ListView.builder(
                reverse: true,
                itemCount: visible.length,
                itemBuilder: (_, index) {
                  final entry = visible[visible.length - 1 - index];
                  return _LogLine(entry: entry);
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<RunLogsCubit, RunLogsState>(
      builder: (context, state) {
        final l10n = AppLocalizations.of(context);
        final cubit = context.read<RunLogsCubit>();
        Widget chip(String label, LogFilter filter) => ChoiceChip(
              label: Text(label),
              selected: state.filter == filter,
              onSelected: (_) => cubit.setFilter(filter),
            );
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Wrap(
            spacing: 4,
            children: [
              chip(l10n.runLogsFilterAll, LogFilter.all),
              chip(l10n.runLogsFilterBuild, LogFilter.build),
              chip(l10n.runLogsFilterHotReload, LogFilter.hotReload),
              chip(l10n.runLogsFilterErrors, LogFilter.errors),
            ],
          ),
        );
      },
    );
  }
}

class _LogLine extends StatelessWidget {
  const _LogLine({required this.entry});

  final RunLogEntry entry;

  @override
  Widget build(BuildContext context) {
    final timestamp = entry.timestamp.toIso8601String().substring(11, 19);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(timestamp, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(width: 8),
          Text(entry.category, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              entry.line,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}
