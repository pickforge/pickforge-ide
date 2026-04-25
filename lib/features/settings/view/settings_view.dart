import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({super.key});

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final SettingsCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = getIt<SettingsCubit>();
    _cubit.load(Directory.current.path).ignore();
  }

  @override
  void dispose() {
    _cubit.close().ignore();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: BlocBuilder<SettingsCubit, SettingsState>(
        builder: (context, state) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildAgentDropdown(state, context),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildAgentDropdown(SettingsState state, BuildContext context) {
    return Row(
      children: [
        const Text('Default agent: '),
        DropdownButton<AgentProfileId>(
          value: state.defaultAgent != null
              ? AgentProfileId.fromValue(state.defaultAgent!)
              : null,
          items: AgentProfileId.values
              .map(
                (id) => DropdownMenuItem(
                  value: id,
                  child: Text(id.value),
                ),
              )
              .toList(),
          onChanged: (id) {
            if (id != null) {
              context
                  .read<SettingsCubit>()
                  .setDefaultAgent(Directory.current.path, id.value)
                  .ignore();
            }
          },
        ),
      ],
    );
  }
}
