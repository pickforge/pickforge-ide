import 'package:flutter/material.dart';
import 'package:pickforge/shared/command_palette/command.dart';

/// Dialog with a TextField for filtering + ListView of matching commands.
class CommandPalette extends StatefulWidget {
  const CommandPalette({required this.commands, super.key});

  final List<PickforgeCommand> commands;

  @override
  State<CommandPalette> createState() => _CommandPaletteState();
}

class _CommandPaletteState extends State<CommandPalette> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<PickforgeCommand> get _filtered {
    final q = _query.toLowerCase();
    if (q.isEmpty) return widget.commands;
    return widget.commands
        .where(
          (c) =>
              c.title.toLowerCase().contains(q) ||
              (c.hint?.toLowerCase().contains(q) ?? false),
        )
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 400),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(8),
              child: TextField(
                controller: _controller,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'Search commands...',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
            ),
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: _filtered.length,
                itemBuilder: (context, i) {
                  final cmd = _filtered[i];
                  return ListTile(
                    title: Text(cmd.title),
                    subtitle: cmd.hint != null ? Text(cmd.hint!) : null,
                    onTap: () {
                      Navigator.of(context).pop();
                      cmd.run();
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
