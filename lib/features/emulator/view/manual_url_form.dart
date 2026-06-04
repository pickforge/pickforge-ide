import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

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
    final l10n = AppLocalizations.of(context);
    final uri = Uri.tryParse(value);
    if (uri == null || (uri.scheme != 'ws' && uri.scheme != 'wss')) {
      return l10n.manualVmServiceValidationScheme;
    }
    if (!uri.hasAuthority || uri.host.isEmpty) {
      return l10n.manualVmServiceValidationHost;
    }
    if (!uri.hasPort || uri.port < 1 || uri.port > 65535) {
      return l10n.manualVmServiceValidationPort;
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
    if (mounted) await Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.manualVmServiceTitle,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            decoration: InputDecoration(
              hintText: l10n.manualVmServiceHint,
              border: const OutlineInputBorder(),
              errorText: _error,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => Navigator.of(context).maybePop(),
                child:
                    Text(MaterialLocalizations.of(context).cancelButtonLabel),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _submit,
                child: Text(l10n.manualVmServiceConnect),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
