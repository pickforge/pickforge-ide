import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

const goldenSurfaceSize = Size(900, 700);

bool get skipGoldenPlatform => !Platform.isLinux;

Future<void> loadGoldenFonts() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  final flutterRoot = Platform.environment['FLUTTER_ROOT'];
  if (flutterRoot == null || flutterRoot.isEmpty) return;

  final fontsDir = Directory(
    p.join(flutterRoot, 'bin', 'cache', 'artifacts', 'material_fonts'),
  );
  if (!fontsDir.existsSync()) return;

  await _loadFamily(fontsDir, 'Roboto');
  await _loadFamily(fontsDir, 'Inter');
  await _loadFamily(fontsDir, 'JetBrainsMono');
  await (FontLoader('MaterialIcons')
        ..addFont(_font(fontsDir, 'MaterialIcons-Regular.otf')))
      .load();
}

Future<void> pumpGoldenSurface(
  WidgetTester tester, {
  required Key boundaryKey,
  required Widget child,
  Size size = goldenSurfaceSize,
}) async {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  addTearDown(() {
    tester.view
      ..resetPhysicalSize()
      ..resetDevicePixelRatio();
  });

  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: PickforgeTheme.dark(),
      darkTheme: PickforgeTheme.dark(),
      themeMode: ThemeMode.dark,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) {
        final mediaQuery = MediaQuery.of(context);
        return MediaQuery(
          data: mediaQuery.copyWith(
            boldText: false,
            disableAnimations: true,
            textScaler: TextScaler.noScaling,
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: RepaintBoundary(
        key: boundaryKey,
        child: SizedBox.fromSize(
          size: size,
          child: ColoredBox(
            color: PickforgeTheme.dark().scaffoldBackgroundColor,
            child: Material(
              color: Colors.transparent,
              child: child,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

Future<void> expectGolden(Key boundaryKey, String name) {
  return expectLater(
    find.byKey(boundaryKey),
    matchesGoldenFile('baselines/$name.png'),
  );
}

Future<void> _loadFamily(Directory fontsDir, String family) {
  return (FontLoader(family)
        ..addFont(_font(fontsDir, 'Roboto-Regular.ttf'))
        ..addFont(_font(fontsDir, 'Roboto-Medium.ttf'))
        ..addFont(_font(fontsDir, 'Roboto-Bold.ttf')))
      .load();
}

Future<ByteData> _font(Directory fontsDir, String filename) async {
  final bytes = await File(p.join(fontsDir.path, filename)).readAsBytes();
  return ByteData.sublistView(bytes);
}
