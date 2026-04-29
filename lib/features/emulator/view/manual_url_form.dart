import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';

class ManualUrlForm extends StatefulWidget {
  const ManualUrlForm({super.key});

  @override
  State<ManualUrlForm> createState() => _ManualUrlFormState();
}

class _ManualUrlFormState extends State<ManualUrlForm> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String? _validate(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null || (uri.scheme != 'ws' && uri.scheme != 'wss')) {
      return 'URL must start with ws:// or wss://';
    }
    if (!uri.hasAuthority || uri.host.isEmpty) return 'URL must include a host';
    if (!uri.hasPort || uri.port < 1 || uri.port > 65535) {
      return 'URL must include a valid port';
    }
    return null;
  }

  Future<void> _submit() async {
    final value = _controller.text.trim();
    final error = _validate(value);
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    await context.read<EmulatorSessionCubit>().submitManualUrl(value);
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Manual VM Service URL', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            decoration: InputDecoration(
              hintText: 'ws://127.0.0.1:PORT/UUID/ws',
              border: const OutlineInputBorder(),
              errorText: _error,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(onPressed: () => Navigator.of(context).maybePop(), child: const Text('Cancel')),
              const SizedBox(width: 8),
              FilledButton(onPressed: _submit, child: const Text('Connect')),
            ],
          ),
        ],
      ),
    );
  }
}
