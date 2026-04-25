import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class OnboardingView extends StatefulWidget {
  const OnboardingView({super.key, this.pickFolder});

  /// Override for tests.
  final Future<String?> Function()? pickFolder;

  @override
  State<OnboardingView> createState() => _OnboardingViewState();
}

class _OnboardingViewState extends State<OnboardingView> {
  String? _error;

  Future<void> _onPick() async {
    final picker = widget.pickFolder ?? getDirectoryPath;
    final picked = await picker();
    if (picked == null) return;
    if (!mounted) return;
    try {
      await context.read<ProjectsCubit>().add(picked);
      if (!mounted) return;
      final s = context.read<ProjectsCubit>().state;
      if (s is ProjectsError) {
        setState(() => _error = s.message);
      }
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.folder_open, size: 64),
              const SizedBox(height: 24),
              Text(
                l10n.onboardingHeading,
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _onPick,
                icon: const Icon(Icons.add),
                label: Text(l10n.workbenchPickFolder),
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
