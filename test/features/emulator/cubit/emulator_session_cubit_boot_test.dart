import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}

class _MD extends Mock implements DeviceDiscoveryService {}

class _ML extends Mock implements AvdLauncher {}

class _MP extends Mock implements BootReadinessPoller {}

class _MR extends Mock implements RunSessionController {}

class _MLog extends Mock implements RunSessionLogRepository {}

class _MV extends Mock implements VmServiceClient {}

class _FakeHandle extends Mock implements AvdLaunchHandle {}

void main() {
  late _MS settings;
  late _MD disc;
  late _ML launcher;
  late _MP poller;
  late _MR run;
  late _MLog log;
  late _MV vm;
  late _FakeHandle handle;

  setUpAll(() {
    registerFallbackValue(Duration.zero);
    registerFallbackValue(CancelToken());
    registerFallbackValue(const EmulatorLaunchOptions());
  });

  setUp(() {
    settings = _MS();
    disc = _MD();
    launcher = _ML();
    poller = _MP();
    run = _MR();
    log = _MLog();
    vm = _MV();
    handle = _FakeHandle();
    when(() => settings.getEmulatorLaunchOptions('/p'))
        .thenAnswer((_) async => const EmulatorLaunchOptions());
    when(() => handle.cancel()).thenAnswer((_) async {});
  });

  EmulatorSessionCubit build() => EmulatorSessionCubit(
        projectRoot: '/p',
        settings: settings,
        discovery: disc,
        launcher: launcher,
        poller: poller,
        runController: run,
        logRepo: log,
        vmClient: vm,
      );
  const avd =
      Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootAvd: launch + ready -> idle',
    setUp: () {
      when(
        () => launcher.launch(
          'Pixel_5_API_34',
          options: any(named: 'options'),
        ),
      ).thenAnswer((_) async => handle);
      when(
        () => poller.poll(
          avdId: any(named: 'avdId'),
          timeout: any(named: 'timeout'),
          interval: any(named: 'interval'),
          cancel: any(named: 'cancel'),
        ),
      ).thenAnswer((_) => Stream.value(const BootReady('emulator-5554')));
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) => c.bootAvd(),
    expect: () => [
      isA<Booting>(),
      isA<Idle>().having((s) => s.serial, 'serial', 'emulator-5554'),
    ],
    verify: (_) => verify(
      () => launcher.launch('Pixel_5_API_34'),
    ).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootAvd: passes saved launch options',
    setUp: () {
      const options = EmulatorLaunchOptions(
        noAudio: true,
        gpuMode: EmulatorGpuMode.host,
        port: 5556,
      );
      when(() => settings.getEmulatorLaunchOptions('/p'))
          .thenAnswer((_) async => options);
      when(() => launcher.launch('Pixel_5_API_34', options: options))
          .thenAnswer((_) async => handle);
      when(
        () => poller.poll(
          avdId: any(named: 'avdId'),
          timeout: any(named: 'timeout'),
          interval: any(named: 'interval'),
          cancel: any(named: 'cancel'),
        ),
      ).thenAnswer((_) => Stream.value(const BootReady('emulator-5556')));
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) => c.bootAvd(),
    expect: () => [
      isA<Booting>(),
      isA<Idle>().having((s) => s.serial, 'serial', 'emulator-5556'),
    ],
    verify: (_) => verify(
      () => launcher.launch(
        'Pixel_5_API_34',
        options: const EmulatorLaunchOptions(
          noAudio: true,
          gpuMode: EmulatorGpuMode.host,
          port: 5556,
        ),
      ),
    ).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootAvd: timeout -> error, kills launch handle',
    setUp: () {
      when(
        () => launcher.launch(
          'Pixel_5_API_34',
          options: any(named: 'options'),
        ),
      ).thenAnswer((_) async => handle);
      when(
        () => poller.poll(
          avdId: any(named: 'avdId'),
          timeout: any(named: 'timeout'),
          interval: any(named: 'interval'),
          cancel: any(named: 'cancel'),
        ),
      ).thenAnswer((_) => Stream.value(const BootTimeout()));
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) => c.bootAvd(),
    expect: () => [isA<Booting>(), isA<EmulatorError>()],
    verify: (_) => verify(() => handle.cancel()).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'cancelBoot: returns to cold and kills handle',
    setUp: () {
      when(
        () => launcher.launch(
          'Pixel_5_API_34',
          options: any(named: 'options'),
        ),
      ).thenAnswer((_) async => handle);
      when(
        () => poller.poll(
          avdId: any(named: 'avdId'),
          timeout: any(named: 'timeout'),
          interval: any(named: 'interval'),
          cancel: any(named: 'cancel'),
        ),
      ).thenAnswer((_) async* {
        yield const BootPending(Duration(milliseconds: 5));
        await Future<void>.delayed(const Duration(milliseconds: 30));
        yield const BootCancelled();
      });
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) async {
      final f = c.bootAvd();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      c.cancelBoot();
      await f;
    },
    expect: () => [isA<Booting>(), isA<Cold>()],
  );
}
