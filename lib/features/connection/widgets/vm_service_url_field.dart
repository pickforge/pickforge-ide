import 'package:flutter/material.dart';

/// Text field for entering the VM Service WebSocket URL.
class VmServiceUrlField extends StatelessWidget {
  const VmServiceUrlField({
    required this.controller,
    this.onSubmitted,
    super.key,
  });

  final TextEditingController controller;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      decoration: const InputDecoration(
        labelText: 'VM Service URL',
        hintText: 'ws://127.0.0.1:PORT/UUID=/ws',
        border: OutlineInputBorder(),
      ),
      onSubmitted: onSubmitted,
    );
  }
}
