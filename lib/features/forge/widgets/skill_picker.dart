import 'package:flutter/material.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';

class SkillPicker extends StatelessWidget {
  const SkillPicker({
    required this.value,
    required this.onChanged,
    super.key,
  });

  final SkillId value;
  final ValueChanged<SkillId> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButton<SkillId>(
      value: value,
      items: SkillId.values
          .map(
            (s) => DropdownMenuItem(
              value: s,
              child: Text(s.value),
            ),
          )
          .toList(),
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
