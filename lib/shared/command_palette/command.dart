import 'package:flutter/foundation.dart';

/// A single command available in the command palette.
class PickforgeCommand {
  const PickforgeCommand({
    required this.id,
    required this.run,
    this.title = '',
    this.hint,
  });

  final String id;
  final String title;
  final String? hint;
  final VoidCallback run;
}
