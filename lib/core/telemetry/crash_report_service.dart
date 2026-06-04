import 'dart:async';

import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

typedef CrashReportAppRunner = FutureOr<void> Function();
typedef CrashReportInitializer = Future<void> Function(
  CrashReportConfig config,
  CrashReportAppRunner appRunner,
);

class CrashReportConfig {
  const CrashReportConfig({
    required this.dsn,
    required this.environment,
    required this.release,
  });

  static const fromEnvironment = CrashReportConfig(
    dsn: String.fromEnvironment('PICKFORGE_SENTRY_DSN'),
    environment: String.fromEnvironment(
      'PICKFORGE_SENTRY_ENVIRONMENT',
      defaultValue: 'local',
    ),
    release: String.fromEnvironment('PICKFORGE_RELEASE'),
  );

  final String dsn;
  final String environment;
  final String release;

  bool get hasDsn => dsn.trim().isNotEmpty;
}

class CrashReportService {
  const CrashReportService({
    required TelemetrySettingsRepository settings,
    CrashReportConfig config = CrashReportConfig.fromEnvironment,
    CrashReportInitializer initializer = _initializeSentry,
  })  : _settings = settings,
        _config = config,
        _initializer = initializer;

  final TelemetrySettingsRepository _settings;
  final CrashReportConfig _config;
  final CrashReportInitializer _initializer;

  Future<void> run({required CrashReportAppRunner appRunner}) async {
    final settings = await _settings.load();
    if (!settings.enabled || !_config.hasDsn) {
      await appRunner();
      return;
    }

    var appRunnerStarted = false;
    Future<void> guardedAppRunner() async {
      appRunnerStarted = true;
      await appRunner();
    }

    try {
      await _initializer(_config, guardedAppRunner);
    } on Object {
      if (appRunnerStarted) rethrow;
      await appRunner();
    }
  }
}

Future<void> _initializeSentry(
  CrashReportConfig config,
  CrashReportAppRunner appRunner,
) {
  return SentryFlutter.init(
    (options) => configureCrashReportOptions(options, config),
    appRunner: appRunner,
  );
}

void configureCrashReportOptions(
  SentryFlutterOptions options,
  CrashReportConfig config,
) {
  options
    ..dsn = config.dsn.trim()
    ..environment = config.environment.trim()
    ..sendDefaultPii = false
    ..reportPackages = false
    ..autoInitializeNativeSdk = false
    ..enableNativeCrashHandling = false
    ..enableAutoSessionTracking = false
    ..enableWatchdogTerminationTracking = false
    ..enableAppHangTracking = false
    ..enableAutoPerformanceTracing = false
    ..enableFramesTracking = false
    ..enableTimeToFullDisplayTracing = false
    ..enableUserInteractionTracing = false
    ..enableUserInteractionBreadcrumbs = false
    ..enableAutoNativeBreadcrumbs = false
    ..enableAppLifecycleBreadcrumbs = false
    ..enableWindowMetricBreadcrumbs = false
    ..enableBrightnessChangeBreadcrumbs = false
    ..enableTextScaleChangeBreadcrumbs = false
    ..enableMemoryPressureBreadcrumbs = false
    ..maxBreadcrumbs = 0
    ..attachScreenshot = false
    ..reportViewHierarchyIdentifiers = false
    ..tracesSampleRate = 0
    ..beforeBreadcrumb = _dropBreadcrumb
    ..beforeSend = _sanitizeBeforeSend
    ..beforeSendFeedback = _dropEvent
    ..beforeSendTransaction = _dropTransaction;

  final release = config.release.trim();
  if (release.isNotEmpty) {
    options.release = release;
  }
}

Breadcrumb? _dropBreadcrumb(Breadcrumb? breadcrumb, Hint hint) => null;

SentryEvent? _dropEvent(SentryEvent event, Hint hint) => null;

SentryTransaction? _dropTransaction(SentryTransaction transaction) => null;

SentryEvent _sanitizeBeforeSend(SentryEvent event, Hint hint) {
  hint
    ..attachments.clear()
    ..screenshot = null
    ..viewHierarchy = null;
  return sanitizeSentryEventForPrivacy(event);
}

SentryEvent sanitizeSentryEventForPrivacy(SentryEvent event) {
  return SentryEvent(
    eventId: event.eventId,
    timestamp: event.timestamp,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    level: event.level,
    tags: const {'pickforge.privacy': 'sanitized'},
    message: const SentryMessage('Pickforge crash report'),
    exceptions:
        event.exceptions?.map(_sanitizeException).toList(growable: false),
  );
}

SentryException _sanitizeException(SentryException exception) {
  return SentryException(
    type: _safeLabel(exception.type),
    value: '<redacted>',
    stackTrace: exception.stackTrace == null
        ? null
        : _sanitizeStackTrace(exception.stackTrace!),
    mechanism: exception.mechanism == null
        ? null
        : _sanitizeMechanism(exception.mechanism!),
    threadId: exception.threadId,
  );
}

Mechanism _sanitizeMechanism(Mechanism mechanism) {
  return Mechanism(
    type: _safeLabel(mechanism.type) ?? 'generic',
    handled: mechanism.handled,
    synthetic: mechanism.synthetic,
    isExceptionGroup: mechanism.isExceptionGroup,
    exceptionId: mechanism.exceptionId,
    parentId: mechanism.parentId,
  );
}

SentryStackTrace _sanitizeStackTrace(SentryStackTrace stackTrace) {
  return SentryStackTrace(
    frames: stackTrace.frames.map(_sanitizeFrame).toList(growable: false),
    lang: stackTrace.lang,
    snapshot: stackTrace.snapshot,
  );
}

SentryStackFrame _sanitizeFrame(SentryStackFrame frame) {
  return SentryStackFrame(
    fileName: _leafName(frame.fileName),
    function: _safeLabel(frame.function),
    lineNo: frame.lineNo,
    colNo: frame.colNo,
    inApp: frame.inApp,
    native: frame.native,
    platform: _safeLabel(frame.platform),
    stackStart: frame.stackStart,
  );
}

String? _leafName(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  final normalized = trimmed.replaceAll(r'\', '/');
  final index = normalized.lastIndexOf('/');
  final leafName = index == -1 ? normalized : normalized.substring(index + 1);
  return _safeLabel(leafName);
}

String? _safeLabel(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  final lower = trimmed.toLowerCase();
  final looksSensitive = lower.contains('/home/') ||
      lower.contains('/users/') ||
      lower.contains(r'\users') ||
      lower.contains('/private/') ||
      lower.contains('://') ||
      lower.contains('token') ||
      lower.contains('secret') ||
      lower.contains('api_key') ||
      lower.contains('apikey') ||
      lower.contains('authorization') ||
      lower.contains('bearer ');
  if (looksSensitive) return '<redacted>';
  return trimmed.length <= 160 ? trimmed : trimmed.substring(0, 160);
}
