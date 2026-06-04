import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/telemetry/crash_report_service.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('runs app without Sentry when telemetry is disabled', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );
    var initialized = false;
    var ran = false;
    final service = CrashReportService(
      settings: repository,
      config: const CrashReportConfig(
        dsn: 'https://public@example.invalid/1',
        environment: 'test',
        release: '0.1.0+1',
      ),
      initializer: (_, __) async => initialized = true,
    );

    await service.run(appRunner: () => ran = true);

    expect(initialized, isFalse);
    expect(ran, isTrue);
  });

  test('runs app without Sentry when DSN is missing', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repository.setEnabled(enabled: true);
    var initialized = false;
    var ran = false;
    final service = CrashReportService(
      settings: repository,
      config: const CrashReportConfig(
        dsn: '',
        environment: 'test',
        release: '0.1.0+1',
      ),
      initializer: (_, __) async => initialized = true,
    );

    await service.run(appRunner: () => ran = true);

    expect(initialized, isFalse);
    expect(ran, isTrue);
  });

  test('initializes Sentry when telemetry is enabled and DSN exists', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repository.setEnabled(enabled: true);
    var initialized = false;
    var ran = false;
    final service = CrashReportService(
      settings: repository,
      config: const CrashReportConfig(
        dsn: 'https://public@example.invalid/1',
        environment: 'test',
        release: '0.1.0+1',
      ),
      initializer: (_, appRunner) async {
        initialized = true;
        await appRunner();
      },
    );

    await service.run(appRunner: () => ran = true);

    expect(initialized, isTrue);
    expect(ran, isTrue);
  });

  test('runs app when Sentry initialization fails before startup', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repository.setEnabled(enabled: true);
    var ran = false;
    final service = CrashReportService(
      settings: repository,
      config: const CrashReportConfig(
        dsn: 'https://public@example.invalid/1',
        environment: 'test',
        release: '0.1.0+1',
      ),
      initializer: (_, __) async => throw StateError('bad dsn'),
    );

    await service.run(appRunner: () => ran = true);

    expect(ran, isTrue);
  });

  test('rethrows app startup errors from the Sentry app runner', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repository.setEnabled(enabled: true);
    final service = CrashReportService(
      settings: repository,
      config: const CrashReportConfig(
        dsn: 'https://public@example.invalid/1',
        environment: 'test',
        release: '0.1.0+1',
      ),
      initializer: (_, appRunner) async => appRunner(),
    );

    await expectLater(
      service.run(appRunner: () => throw StateError('startup failed')),
      throwsA(isA<StateError>()),
    );
  });

  test('configures Sentry with privacy controls', () {
    final options = SentryFlutterOptions();

    configureCrashReportOptions(
      options,
      const CrashReportConfig(
        dsn: ' https://public@example.invalid/1 ',
        environment: 'dogfood',
        release: '0.1.0+1',
      ),
    );

    expect(options.dsn, 'https://public@example.invalid/1');
    expect(options.environment, 'dogfood');
    expect(options.release, '0.1.0+1');
    expect(options.sendDefaultPii, isFalse);
    expect(options.autoInitializeNativeSdk, isFalse);
    expect(options.enableNativeCrashHandling, isFalse);
    expect(options.enableAutoSessionTracking, isFalse);
    expect(options.enableAutoPerformanceTracing, isFalse);
    expect(options.enableUserInteractionBreadcrumbs, isFalse);
    expect(options.maxBreadcrumbs, 0);
    expect(options.attachScreenshot, isFalse);
    expect(options.tracesSampleRate, 0);
    expect(options.beforeBreadcrumb!(Breadcrumb(message: 'x'), Hint()), isNull);
    expect(options.beforeSendTransaction, isNotNull);
    expect(options.beforeSendFeedback, isNotNull);
  });

  test('sanitizes Sentry events before send', () {
    final event = SentryEvent(
      message: const SentryMessage('/home/dev/project/token'),
      user: SentryUser(id: 'user-1', email: 'dev@example.com'),
      request: SentryRequest(
        url: 'https://example.invalid/private?token=abc',
        headers: const {'authorization': 'Bearer abc'},
      ),
      breadcrumbs: [
        Breadcrumb(message: '/home/dev/project/lib/main.dart'),
      ],
      exceptions: [
        SentryException(
          type: 'FileSystemException',
          value: '/home/dev/project/lib/main.dart token=abc',
          stackTrace: SentryStackTrace(
            frames: [
              SentryStackFrame(
                absPath: '/home/dev/project/lib/main.dart',
                fileName: '/home/dev/project/lib/main.dart',
                function: 'buildWidget',
                contextLine: 'final token = secret;',
                preContext: const ['source before'],
                postContext: const ['source after'],
                vars: const {'secret': 'abc'},
                lineNo: 42,
                colNo: 7,
                inApp: true,
              ),
            ],
          ),
        ),
      ],
    );

    final sanitized = sanitizeSentryEventForPrivacy(event);
    final sanitizedException = sanitized.exceptions!.single;
    final sanitizedFrame = sanitizedException.stackTrace!.frames.single;

    expect(sanitized.message!.formatted, 'Pickforge crash report');
    expect(sanitized.user, isNull);
    expect(sanitized.request, isNull);
    expect(sanitized.breadcrumbs, isNull);
    expect(sanitized.tags, const {'pickforge.privacy': 'sanitized'});
    expect(sanitizedException.type, 'FileSystemException');
    expect(sanitizedException.value, '<redacted>');
    expect(sanitizedFrame.absPath, isNull);
    expect(sanitizedFrame.fileName, 'main.dart');
    expect(sanitizedFrame.function, 'buildWidget');
    expect(sanitizedFrame.contextLine, isNull);
    expect(sanitizedFrame.preContext, isEmpty);
    expect(sanitizedFrame.postContext, isEmpty);
    expect(sanitizedFrame.vars, isEmpty);
    expect(sanitizedFrame.lineNo, 42);
    expect(sanitizedFrame.colNo, 7);
  });
}
