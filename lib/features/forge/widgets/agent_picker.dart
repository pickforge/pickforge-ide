import 'package:flutter/material.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';

class AgentPicker extends StatelessWidget {
  const AgentPicker({
    required this.value,
    required this.onChanged,
    super.key,
  });

  final AgentProfileId value;
  final ValueChanged<AgentProfileId> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButton<AgentProfileId>(
      value: value,
      items: AgentProfileId.values
          .map(
            (p) => DropdownMenuItem(
              value: p,
              child: Text(p.value),
            ),
          )
          .toList(),
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
