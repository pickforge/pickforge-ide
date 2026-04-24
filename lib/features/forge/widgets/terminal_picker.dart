import 'package:flutter/material.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class TerminalPicker extends StatelessWidget {
  const TerminalPicker({
    required this.available,
    required this.value,
    required this.onChanged,
    super.key,
  });

  final List<TerminalProfile> available;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButton<String>(
      value: value,
      items: available
          .map(
            (t) => DropdownMenuItem(
              value: t.id,
              child: Text(t.displayName),
            ),
          )
          .toList(),
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
