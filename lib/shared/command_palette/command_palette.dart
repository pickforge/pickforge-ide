import 'dart:async';

import 'package:flutter/material.dart';
import 'package:pickforge/shared/command_palette/command.dart';

typedef CommandSearchProvider = Future<List<PickforgeCommand>> Function(
  String query,
);

/// Dialog with a TextField for filtering + ListView of matching commands.
class CommandPalette extends StatefulWidget {
  const CommandPalette({
    required this.commands,
    this.searchCommands,
    super.key,
  });

  final List<PickforgeCommand> commands;
  final CommandSearchProvider? searchCommands;

  @override
  State<CommandPalette> createState() => _CommandPaletteState();
}

class _CommandPaletteState extends State<CommandPalette> {
  final _controller = TextEditingController();
  String _query = '';
  List<PickforgeCommand> _searchResults = const [];
  var _searching = false;
  var _searchGeneration = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<PickforgeCommand> get _filtered {
    final q = _query.toLowerCase();
    final local = q.isEmpty
        ? widget.commands
        : widget.commands
            .where(
              (c) => _matches(q, [c.title, c.hint]),
            )
            .toList();
    return [...local, ..._searchResults];
  }

  void _setQuery(String value) {
    setState(() => _query = value);
    unawaited(_loadSearchResults(value));
  }

  Future<void> _loadSearchResults(String value) async {
    final provider = widget.searchCommands;
    final query = value.trim();
    final generation = ++_searchGeneration;
    if (provider == null || query.isEmpty) {
      if (!mounted) return;
      setState(() {
        _searching = false;
        _searchResults = const [];
      });
      return;
    }

    setState(() => _searching = true);
    late final List<PickforgeCommand> results;
    try {
      results = await provider(query);
    } on Object {
      results = const [];
    }
    if (!mounted || generation != _searchGeneration) return;
    setState(() {
      _searching = false;
      _searchResults = results;
    });
  }

  bool _matches(String query, Iterable<String?> values) {
    return values.any((value) {
      final normalized = value?.toLowerCase() ?? '';
      return normalized.contains(query);
    });
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
                onChanged: _setQuery,
              ),
            ),
            if (_searching) const LinearProgressIndicator(minHeight: 1),
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
