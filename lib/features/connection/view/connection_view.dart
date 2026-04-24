import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/connection/bloc/connection_bloc.dart';
import 'package:pickforge/features/connection/bloc/connection_event.dart';
import 'package:pickforge/features/connection/bloc/connection_state.dart'
    as conn;
import 'package:pickforge/features/connection/widgets/vm_service_url_field.dart';

/// Screen for connecting to a Flutter app's VM Service.
///
/// If [bloc] is provided, uses it via `BlocProvider.value`.
/// Otherwise constructs one from DI singletons.
class ConnectionView extends StatefulWidget {
  const ConnectionView({this.bloc, this.projectRoot, super.key});

  final ConnectionBloc? bloc;
  final String? projectRoot;

  @override
  State<ConnectionView> createState() => _ConnectionViewState();
}

class _ConnectionViewState extends State<ConnectionView> {
  late final ConnectionBloc _bloc;
  late final TextEditingController _urlController;

  @override
  void initState() {
    super.initState();
    _bloc = widget.bloc ??
        ConnectionBloc(
          getIt<VmServiceClient>(),
          getIt<ProjectSettingsRepository>(),
        );
    _urlController = TextEditingController();
    _bootstrap().ignore();
  }

  Future<void> _bootstrap() async {
    _bloc.add(
      ConnectionEvent.bootstrap(
        projectRoot: widget.projectRoot ?? Directory.current.path,
      ),
    );
  }

  @override
  void dispose() {
    _urlController.dispose();
    if (widget.bloc == null) _bloc.close().ignore();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _bloc,
      child: BlocConsumer<ConnectionBloc, conn.ConnectionState>(
        listener: (context, state) {
          state.maybeWhen(
            connected: (_) => context.go(AppRoutes.dock),
            error: (_, message) => ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(message)),
            ),
            orElse: () {},
          );
          final url = state.maybeWhen(
            connected: (u) => u,
            error: (u, _) => u,
            orElse: () => null,
          );
          if (url != null) _urlController.text = url;
        },
        builder: (context, state) {
          return Scaffold(
            body: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Connect to VM Service',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 16),
                      VmServiceUrlField(
                        controller: _urlController,
                        onSubmitted: (_) => _connect(),
                      ),
                      const SizedBox(height: 16),
                      _buildStatus(state, context),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: state.maybeWhen(
                          connecting: (_) => null,
                          orElse: () => _connect,
                        ),
                        child: state.maybeWhen(
                          connecting: (_) => const Text('Connecting...'),
                          connected: (_) => const Text('Disconnect'),
                          orElse: () => const Text('Connect'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildStatus(conn.ConnectionState state, BuildContext context) {
    return state.maybeWhen(
      idle: (savedUrl) => savedUrl == null
          ? const SizedBox.shrink()
          : Text(
              'Last used: $savedUrl',
              style: Theme.of(context).textTheme.bodySmall,
            ),
      connected: (url) => Text(
        'Connected: $url',
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
            ),
      ),
      error: (_, message) => Text(
        message,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.error,
            ),
      ),
      orElse: () => const SizedBox.shrink(),
    );
  }

  void _connect() {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;
    final state = _bloc.state;
    if (state.maybeWhen(
      connected: (_) => true,
      orElse: () => false,
    )) {
      _bloc.add(const ConnectionEvent.disconnectPressed());
    } else {
      _bloc.add(ConnectionEvent.connectPressed(url: url));
    }
  }
}
