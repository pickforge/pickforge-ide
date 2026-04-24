import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/history/cubit/history_cubit.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class HistoryView extends StatelessWidget {
  const HistoryView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => getIt<HistoryCubit>(),
      child: const _HistoryViewBody(),
    );
  }
}

class _HistoryViewBody extends StatelessWidget {
  const _HistoryViewBody();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return BlocBuilder<HistoryCubit, List<PickHistoryRow>>(
      builder: (context, rows) {
        if (rows.isEmpty) {
          return Center(child: Text(l10n.historyTitle));
        }

        return ListView.separated(
          itemCount: rows.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final row = rows[i];
            final location = row.creationFile != null
                ? '${row.creationFile}:${row.creationLine}'
                : 'unknown';

            return ListTile(
              title: Text(row.widgetClass),
              subtitle:
                  Text('$location  ${row.agentId}\u00B7${row.terminalId}'),
            );
          },
        );
      },
    );
  }
}
