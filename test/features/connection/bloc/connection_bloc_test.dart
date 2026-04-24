import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/connection/bloc/connection_bloc.dart';
import 'package:pickforge/features/connection/bloc/connection_event.dart';
import 'package:pickforge/features/connection/bloc/connection_state.dart';

class _MockVmServiceClient extends Mock implements VmServiceClient {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

class _MockInspector extends Mock implements InspectorRepository {}

void main() {
  late VmServiceClient vmClient;
  late ProjectSettingsRepository settings;
  late InspectorRepository inspector;

  setUp(() {
    vmClient = _MockVmServiceClient();
    settings = _MockSettings();
    inspector = _MockInspector();
    registerFallbackValue(const ConnectionState.idle());
  });

  group('bootstrap', () {
    blocTest<ConnectionBloc, ConnectionState>(
      'emits idle with saved URL',
      setUp: () {
        when(() => settings.getVmServiceUrl('/root'))
            .thenAnswer((_) async => 'ws://saved/ws');
      },
      build: () => ConnectionBloc(vmClient, settings),
      act: (bloc) =>
          bloc.add(const ConnectionEvent.bootstrap(projectRoot: '/root')),
      expect: () => [
        const ConnectionState.idle(savedUrl: 'ws://saved/ws'),
      ],
    );

    blocTest<ConnectionBloc, ConnectionState>(
      'emits idle with null savedUrl when nothing saved',
      setUp: () {
        when(() => settings.getVmServiceUrl('/root'))
            .thenAnswer((_) async => null);
      },
      build: () => ConnectionBloc(vmClient, settings),
      act: (bloc) =>
          bloc.add(const ConnectionEvent.bootstrap(projectRoot: '/root')),
      expect: () => [
        const ConnectionState.idle(),
      ],
    );
  });

  group('connect', () {
    blocTest<ConnectionBloc, ConnectionState>(
      'emits connecting then connected on success',
      setUp: () {
        when(() => vmClient.connect('ws://test/ws')).thenAnswer((_) async {});
        when(() => settings.setVmServiceUrl(any(), any()))
            .thenAnswer((_) async {});
      },
      build: () => ConnectionBloc(vmClient, settings),
      seed: () => const ConnectionState.idle(),
      act: (bloc) => bloc.add(
        const ConnectionEvent.connectPressed(url: 'ws://test/ws'),
      ),
      expect: () => [
        const ConnectionState.connecting(url: 'ws://test/ws'),
        const ConnectionState.connected(url: 'ws://test/ws'),
      ],
    );

    blocTest<ConnectionBloc, ConnectionState>(
      'emits error on connection failure',
      setUp: () {
        when(() => vmClient.connect('ws://bad/ws'))
            .thenThrow(StateError('refused'));
      },
      build: () => ConnectionBloc(vmClient, settings),
      seed: () => const ConnectionState.idle(),
      act: (bloc) => bloc.add(
        const ConnectionEvent.connectPressed(url: 'ws://bad/ws'),
      ),
      expect: () => [
        const ConnectionState.connecting(url: 'ws://bad/ws'),
        const ConnectionState.error(
          url: 'ws://bad/ws',
          message: 'Bad state: refused',
        ),
      ],
    );

    blocTest<ConnectionBloc, ConnectionState>(
      'calls enableSelectMode when inspector provided',
      setUp: () {
        when(() => vmClient.connect('ws://test/ws')).thenAnswer((_) async {});
        when(() => settings.setVmServiceUrl(any(), any()))
            .thenAnswer((_) async {});
        when(() => inspector.enableSelectMode()).thenAnswer((_) async {});
      },
      build: () => ConnectionBloc(vmClient, settings, inspector: inspector),
      seed: () => const ConnectionState.idle(),
      act: (bloc) => bloc.add(
        const ConnectionEvent.connectPressed(url: 'ws://test/ws'),
      ),
      verify: (_) {
        verify(() => inspector.enableSelectMode()).called(1);
      },
      expect: () => [
        const ConnectionState.connecting(url: 'ws://test/ws'),
        const ConnectionState.connected(url: 'ws://test/ws'),
      ],
    );

    blocTest<ConnectionBloc, ConnectionState>(
      'saves URL to settings on success',
      setUp: () {
        when(() => vmClient.connect('ws://test/ws')).thenAnswer((_) async {});
        when(() => settings.getVmServiceUrl(any()))
            .thenAnswer((_) async => null);
        when(() => settings.setVmServiceUrl(any(), any()))
            .thenAnswer((_) async {});
      },
      build: () => ConnectionBloc(vmClient, settings),
      seed: () => const ConnectionState.idle(),
      act: (bloc) => bloc
        ..add(const ConnectionEvent.bootstrap(projectRoot: '/root'))
        ..add(
          const ConnectionEvent.connectPressed(url: 'ws://test/ws'),
        ),
      verify: (_) {
        verify(() => settings.setVmServiceUrl('/root', 'ws://test/ws'))
            .called(1);
      },
      expect: () => [
        const ConnectionState.connecting(url: 'ws://test/ws'),
        const ConnectionState.connected(url: 'ws://test/ws'),
      ],
    );
  });

  group('disconnect', () {
    blocTest<ConnectionBloc, ConnectionState>(
      'emits idle after disconnect',
      setUp: () {
        when(() => vmClient.disconnect()).thenAnswer((_) async {});
        when(() => settings.getVmServiceUrl(any()))
            .thenAnswer((_) async => 'ws://saved/ws');
      },
      build: () => ConnectionBloc(vmClient, settings),
      seed: () => const ConnectionState.connected(url: 'ws://test/ws'),
      act: (bloc) => bloc
        ..add(const ConnectionEvent.bootstrap(projectRoot: '/root'))
        ..add(const ConnectionEvent.disconnectPressed()),
      expect: () => [
        const ConnectionState.idle(savedUrl: 'ws://saved/ws'),
      ],
    );
  });
}
