import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:window_manager/window_manager.dart';

Future<void> bootstrapWindow() async {
  if (!_isDesktop) return;
  await windowManager.ensureInitialized();
  const options = WindowOptions(
    size: Size(1800, 1100),
    minimumSize: Size(900, 640),
    title: 'Pickforge',
    titleBarStyle: TitleBarStyle.normal,
    backgroundColor: Color(0xFF0A0A0B),
    center: true,
  );
  await windowManager.waitUntilReadyToShow(options, () async {
    await windowManager.setAlwaysOnTop(true);
    await windowManager.show();
    await windowManager.focus();
  });
}

bool get _isDesktop =>
    defaultTargetPlatform == TargetPlatform.linux ||
    defaultTargetPlatform == TargetPlatform.macOS ||
    defaultTargetPlatform == TargetPlatform.windows;
