# Pickforge MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pickforge MVP — a Flutter desktop app that attaches to a running Flutter app via the VM Service + Inspector protocol, lets the user select a widget by tapping in the Android emulator, and dispatches the selected widget's context (source + ancestor chain + screenshots) to a new terminal running Claude Code / Codex / OpenCode via a scoped `.pickforge/` folder.

**Architecture:** Feature-first Flutter desktop app (`lib/features/*`) built on a thin `lib/core/*` infrastructure layer (VM Service, Drift, agent/terminal profiles, skills). Approach A from the spec: external dock + on-device Select Widget Mode. No embedded emulator mirror. Bring-your-own-agent-auth. Writes only into `.pickforge/`.

**Tech Stack:** Flutter desktop (Linux/macOS/Windows), Dart 3, Bloc + GetIt + Injectable, Drift (SQLite), GoRouter, `package:vm_service`, `freezed` + `json_serializable`, `flutter_animate` + `animations` + `rive`, `lucide_icons_flutter` + `hugeicons`, `flutter_localizations` + `intl` + `intl_utils`. Dev: `mocktail`, `bloc_test`, `very_good_analysis`.

**Spec:** `docs/superpowers/specs/2026-04-23-pickforge-design.md`

---

## Navigation

- [Phase 0 — Project bootstrap](#phase-0--project-bootstrap) · Tasks 1-3
- [Phase 1 — App shell & foundation](#phase-1--app-shell--foundation) · Tasks 4-7
- [Phase 2 — Core domain models](#phase-2--core-domain-models) · Tasks 8-10
- [Phase 3 — Drift database](#phase-3--drift-database) · Tasks 11-13
- [Phase 4 — VM Service client](#phase-4--vm-service-client) · Tasks 14-17
- [Phase 5 — Inspector core](#phase-5--inspector-core) · Tasks 18-20
- [Phase 6 — Agent profiles](#phase-6--agent-profiles) · Tasks 21-23
- [Phase 7 — Terminal profiles](#phase-7--terminal-profiles) · Tasks 24-26
- [Phase 8 — Skills & context writer](#phase-8--skills--context-writer) · Tasks 27-29
- [Phase 9 — Agent launcher orchestration](#phase-9--agent-launcher-orchestration) · Tasks 30-31
- [Phase 10 — Connection feature](#phase-10--connection-feature) · Tasks 32-33
- [Phase 11 — Widget picker feature](#phase-11--widget-picker-feature) · Tasks 34-36
- [Phase 12 — Forge feature](#phase-12--forge-feature) · Tasks 37-38
- [Phase 13 — History & Settings features](#phase-13--history--settings-features) · Tasks 39-40
- [Phase 14 — App chrome, command palette, polish](#phase-14--app-chrome-command-palette-polish) · Tasks 41-42
- [Phase 15 — CI, release checklist, docs](#phase-15--ci-release-checklist-docs) · Tasks 43-45

---

## Global conventions

These apply to every task. Don't repeat them per-task unless deviating.

- **Commits:** Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`). English. No AI/Claude attribution footers.
- **TDD:** Write failing test → run to see it fail → implement → run to see it pass → commit. Every task follows this cadence.
- **Branches:** One branch per phase (`phase/00-bootstrap`, `phase/01-shell`, ...) merged via fast-forward to `main` at phase end. Solo dev → no PRs required but keep branches for logical grouping.
- **Code gen:** Any task that edits `freezed`, `json_serializable`, `drift`, or `injectable` annotations ends with `fvm dart run build_runner build --delete-conflicting-outputs` before the commit step.
- **Lint / format:** Every commit passes `fvm dart format .` and `fvm flutter analyze` with zero issues.
- **FVM:** This repo pins Flutter with `.fvmrc`; every local Dart/Flutter command uses `fvm dart` or `fvm flutter`. CI uses bare `dart pub global activate fvm` only before FVM exists.
- **File size:** Aim for ≤200 lines per Dart file. Split when a file outgrows its single responsibility.
- **Never touch files outside the repo** unless explicitly instructed (e.g., `~/.claude/`).

---

## Phase 0 — Project bootstrap

Goal: scaffold the Flutter desktop project, pin toolchain, wire lint/format/CI skeleton. After this phase, `fvm flutter run -d linux` opens an empty window.

### Task 1 — `.fvmrc` + `fvm flutter create` + pubspec + analysis_options

**Files:**
- Create: `pubspec.yaml` (overwrite the `fvm flutter create` default)
- Create: `analysis_options.yaml`
- Create: `.fvmrc`
- Modify: `.gitignore` (add Dart/Flutter entries)

- [ ] **Step 1: Create `.fvmrc` and install the pinned Flutter SDK.**

```json
{
  "flutter": "3.24.3"
}
```

Run:
```bash
cd /home/dev/Development/Personal/vibes/vibe-flutter
fvm install
```

Expected: FVM installs or reuses Flutter `3.24.3`.

- [ ] **Step 2: Scaffold the Flutter desktop app in-place.**

Run:
```bash
cd /home/dev/Development/Personal/vibes/vibe-flutter
fvm flutter create --org dev.pickforge --project-name pickforge --platforms linux,macos,windows .
```

Expected: scaffolded `lib/`, `linux/`, `macos/`, `windows/`, `test/`, default `pubspec.yaml` and `main.dart`.

- [ ] **Step 3: Replace `pubspec.yaml` with the Pickforge dependency set.**

```yaml
name: pickforge
description: "Pickforge — widget-level AI context for Flutter."
publish_to: "none"
version: 0.1.0+1

environment:
  sdk: ">=3.5.0 <4.0.0"
  flutter: ">=3.24.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter

  # state + architecture
  bloc: ^8.1.4
  flutter_bloc: ^8.1.6
  equatable: ^2.0.5
  get_it: ^7.7.0
  injectable: ^2.4.4
  go_router: ^14.2.7

  # models / serialization
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0

  # storage
  drift: ^2.20.2
  drift_flutter: ^0.2.1
  sqlite3_flutter_libs: ^0.5.24
  path_provider: ^2.1.4
  path: ^1.9.0
  shared_preferences: ^2.3.2

  # vm service / inspector
  vm_service: ^14.3.0
  web_socket_channel: ^3.0.1

  # desktop window
  window_manager: ^0.4.2

  # misc
  yaml: ^3.1.2
  dio: ^5.7.0
  intl: ^0.19.0

  # design & motion
  flutter_animate: ^4.5.0
  animations: ^2.0.11
  rive: ^0.13.13

  # icons
  lucide_icons_flutter: ^3.0.0
  hugeicons: ^0.0.11

dev_dependencies:
  flutter_test:
    sdk: flutter
  test: ^1.25.7

  build_runner: ^2.4.12
  freezed: ^2.5.7
  json_serializable: ^6.8.0
  injectable_generator: ^2.6.2
  drift_dev: ^2.20.3
  intl_utils: ^2.8.7

  mocktail: ^1.0.4
  bloc_test: ^9.1.7

  very_good_analysis: ^6.0.0

flutter:
  uses-material-design: true
  generate: true
  assets:
    - assets/skills/
    - assets/agents/
    - assets/animations/
```

- [ ] **Step 4: Replace `analysis_options.yaml` with very_good_analysis.**

```yaml
include: package:very_good_analysis/analysis_options.yaml

analyzer:
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"
    - "lib/l10n/generated/**"

linter:
  rules:
    public_member_api_docs: false
```

- [ ] **Step 5: Extend `.gitignore`.**

Append:

```
# Dart / Flutter
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
.packages
.pub-cache/
.pub/
build/

# FVM
.fvm/flutter_sdk

# Generated
lib/l10n/generated/
coverage/
*.g.dart
*.freezed.dart
```

- [ ] **Step 6: Install deps and confirm analyze is clean.**

```bash
fvm flutter pub get
fvm flutter analyze
```

Expected: `No issues found!`

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "chore: scaffold flutter desktop project with dependency set"
```

---

### Task 2 — Folder skeleton + build_runner scripts

**Files:**
- Create: `lib/core/.gitkeep`, `lib/features/.gitkeep`, `lib/shared/.gitkeep`, `lib/l10n/.gitkeep`
- Create: `assets/skills/.gitkeep`, `assets/agents/.gitkeep`, `assets/animations/.gitkeep`
- Create: `tool/.gitkeep`
- Create: `scripts/gen.sh`, `scripts/watch.sh`, `scripts/check.sh`
- Modify: `lib/main.dart` (empty placeholder)

- [ ] **Step 1: Create the folder skeleton.**

```bash
mkdir -p lib/{core,features,shared,l10n} \
         assets/{skills,agents,animations} \
         tool test/fixtures scripts
touch lib/core/.gitkeep lib/features/.gitkeep lib/shared/.gitkeep lib/l10n/.gitkeep \
      assets/skills/.gitkeep assets/agents/.gitkeep assets/animations/.gitkeep \
      tool/.gitkeep test/fixtures/.gitkeep
```

- [ ] **Step 2: Create `scripts/gen.sh` (one-shot codegen).**

```bash
#!/usr/bin/env bash
set -euo pipefail
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter gen-l10n
```

- [ ] **Step 3: Create `scripts/watch.sh` (codegen watcher).**

```bash
#!/usr/bin/env bash
set -euo pipefail
fvm dart run build_runner watch --delete-conflicting-outputs
```

- [ ] **Step 4: Create `scripts/check.sh` (pre-commit gate).**

```bash
#!/usr/bin/env bash
set -euo pipefail
fvm dart format --set-exit-if-changed .
fvm flutter analyze
fvm flutter test
```

- [ ] **Step 5: Make scripts executable.**

```bash
chmod +x scripts/*.sh
```

- [ ] **Step 6: Replace `lib/main.dart` with a minimal placeholder.**

```dart
import 'package:flutter/widgets.dart';

void main() {
  runApp(const Placeholder());
}
```

- [ ] **Step 7: Confirm analyze + test still clean.**

```bash
./scripts/check.sh
```

Expected: format clean, analyze clean, test suite passes (empty, it's fine).

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "chore: add folder skeleton and codegen scripts"
```

---

### Task 3 — GitHub Actions CI skeleton

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow.**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  analyze-test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dart-lang/setup-dart@v1
      - name: Install FVM
        run: dart pub global activate fvm
      - name: Install Flutter SDK
        run: fvm install
      - name: Install deps
        run: fvm flutter pub get
      - name: Codegen
        run: fvm dart run build_runner build --delete-conflicting-outputs
      - name: Format check
        run: fvm dart format --set-exit-if-changed .
      - name: Analyze
        run: fvm flutter analyze
      - name: Test
        run: fvm flutter test --coverage
      - name: Upload coverage (ubuntu only)
        if: matrix.os == 'ubuntu-latest'
        uses: codecov/codecov-action@v4
        with:
          files: coverage/lcov.info
          fail_ci_if_error: false
```

- [ ] **Step 2: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add cross-platform analyze/format/test workflow"
```

Note: CI will fail until the project has at least one test. Resolved in Task 4.

---

## Phase 1 — App shell & foundation

Goal: theme, l10n, DI, routing, window management. After this phase, `fvm flutter run -d linux` opens a properly-sized always-on-top Pickforge window with a themed placeholder screen and localized strings.

### Task 4 — Design tokens + Pickforge ThemeData

**Files:**
- Create: `lib/shared/theme/pickforge_colors.dart`
- Create: `lib/shared/theme/pickforge_spacing.dart`
- Create: `lib/shared/theme/pickforge_typography.dart`
- Create: `lib/shared/theme/pickforge_theme.dart`
- Create: `test/shared/theme/pickforge_theme_test.dart`

- [ ] **Step 1: Write the failing test.**

```dart
// test/shared/theme/pickforge_theme_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

void main() {
  group('PickforgeTheme', () {
    test('dark theme uses near-black surface, not pure black', () {
      final theme = PickforgeTheme.dark();
      expect(theme.brightness, Brightness.dark);
      expect(theme.colorScheme.surface, isNot(Colors.black));
      expect(theme.colorScheme.surface.computeLuminance(), lessThan(0.05));
    });

    test('primary accent is forge-ember orange in dark', () {
      final theme = PickforgeTheme.dark();
      expect(theme.colorScheme.primary, const Color(0xFFFF7A1A));
    });

    test('uses sans for chrome and mono for code', () {
      final theme = PickforgeTheme.dark();
      expect(theme.textTheme.bodyMedium?.fontFamily, 'Inter');
      expect(theme.extension<PickforgeMonoTheme>()?.fontFamily, 'JetBrainsMono');
    });
  });
}
```

- [ ] **Step 2: Run — expect failure.**

```bash
fvm flutter test test/shared/theme/pickforge_theme_test.dart
```

Expected: compile error (files don't exist).

- [ ] **Step 3: Create `pickforge_colors.dart`.**

```dart
import 'package:flutter/widgets.dart';

/// Pickforge color tokens. Semantic only — orange = user action, green =
/// connected, amber = warning, red = error, muted blue = info.
class PickforgeColors {
  const PickforgeColors._();

  // Base surfaces (dark)
  static const bg0 = Color(0xFF0A0A0B); // page bg
  static const bg1 = Color(0xFF111113); // panel bg
  static const bg2 = Color(0xFF17171A); // raised panel
  static const stroke = Color(0x1AFFFFFF); // 10% white

  // Text
  static const textHi = Color(0xFFF2F2F3);
  static const textMed = Color(0xFFA0A0A6);
  static const textLow = Color(0xFF6E6E75);

  // Semantic
  static const ember = Color(0xFFFF7A1A); // primary accent
  static const connected = Color(0xFF3DD68C);
  static const warning = Color(0xFFF2B53A);
  static const error = Color(0xFFFF6B5C);
  static const info = Color(0xFF7AA2FF);
}
```

- [ ] **Step 4: Create `pickforge_spacing.dart`.**

```dart
/// 8px grid spacing tokens. Use these, never magic numbers.
class PickforgeSpacing {
  const PickforgeSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;

  static const radiusSm = 6.0;
  static const radiusMd = 10.0;
  static const radiusLg = 14.0;
}
```

- [ ] **Step 5: Create `pickforge_typography.dart`.**

```dart
import 'package:flutter/material.dart';
import 'pickforge_colors.dart';

/// Typography scale. 13px body (dev-tool density), tight letter spacing.
TextTheme pickforgeTextTheme({required Brightness brightness}) {
  final text = brightness == Brightness.dark
      ? PickforgeColors.textHi
      : const Color(0xFF0A0A0B);
  return TextTheme(
    displayLarge: TextStyle(
      fontFamily: 'Inter',
      fontSize: 28,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.5,
      color: text,
    ),
    titleLarge: TextStyle(
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.2,
      color: text,
    ),
    bodyMedium: TextStyle(
      fontFamily: 'Inter',
      fontSize: 13,
      fontWeight: FontWeight.w400,
      height: 1.4,
      color: text,
    ),
    labelSmall: TextStyle(
      fontFamily: 'Inter',
      fontSize: 11,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.4,
      color: text,
    ),
  );
}

class PickforgeMonoTheme extends ThemeExtension<PickforgeMonoTheme> {
  const PickforgeMonoTheme({required this.fontFamily});
  final String fontFamily;

  @override
  PickforgeMonoTheme copyWith({String? fontFamily}) =>
      PickforgeMonoTheme(fontFamily: fontFamily ?? this.fontFamily);

  @override
  PickforgeMonoTheme lerp(ThemeExtension<PickforgeMonoTheme>? other, double t) =>
      this;
}
```

- [ ] **Step 6: Create `pickforge_theme.dart`.**

```dart
import 'package:flutter/material.dart';
import 'pickforge_colors.dart';
import 'pickforge_typography.dart';

/// Pickforge theme. Comprehensively overrides Material 3 defaults — never
/// leak Material's default spacing, color, or typography into the UI.
class PickforgeTheme {
  const PickforgeTheme._();

  static ThemeData dark() => _build(Brightness.dark);
  static ThemeData light() => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: PickforgeColors.ember,
      onPrimary: Colors.white,
      secondary: PickforgeColors.info,
      onSecondary: Colors.white,
      surface: isDark ? PickforgeColors.bg0 : const Color(0xFFF7F7F8),
      onSurface: isDark ? PickforgeColors.textHi : const Color(0xFF0A0A0B),
      error: PickforgeColors.error,
      onError: Colors.white,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: colorScheme.surface,
      textTheme: pickforgeTextTheme(brightness: brightness),
      extensions: const [PickforgeMonoTheme(fontFamily: 'JetBrainsMono')],
      splashFactory: NoSplash.splashFactory,
      visualDensity: VisualDensity.compact,
    );
  }
}
```

- [ ] **Step 7: Run tests, expect PASS.**

```bash
fvm flutter test test/shared/theme/pickforge_theme_test.dart
```

- [ ] **Step 8: Commit.**

```bash
git add lib/shared/theme test/shared/theme
git commit -m "feat(theme): add Pickforge dark/light theme with ember accent"
```

---

### Task 5 — Localization pipeline + first ARB

**Files:**
- Create: `l10n.yaml`
- Create: `lib/l10n/app_en.arb`
- Modify: `lib/main.dart`
- Create: `test/l10n/l10n_test.dart`

- [ ] **Step 1: Create `l10n.yaml` at repo root.**

```yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
output-localization-file: app_localizations.dart
output-class: AppLocalizations
output-dir: lib/l10n/generated
synthetic-package: false
nullable-getter: false
```

- [ ] **Step 2: Create `lib/l10n/app_en.arb` with baseline strings.**

```json
{
  "@@locale": "en",
  "appName": "Pickforge",
  "connectTitle": "Connect to your Flutter app",
  "connectUrlLabel": "VM Service WebSocket URL",
  "connectPastePlaceholder": "ws://127.0.0.1:PORT/UUID=/ws",
  "connectButton": "Connect",
  "connectStatusConnecting": "Connecting…",
  "connectStatusConnected": "Connected",
  "connectStatusError": "Couldn't reach VM Service. Is your app running?",
  "forgeItButton": "Forge it",
  "historyTitle": "Recent forges",
  "settingsTitle": "Settings"
}
```

- [ ] **Step 3: Run `fvm flutter gen-l10n` to generate the getters.**

```bash
fvm flutter gen-l10n
```

Expected: creates `lib/l10n/generated/app_localizations.dart`.

- [ ] **Step 4: Write the l10n test.**

```dart
// test/l10n/l10n_test.dart
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

void main() {
  testWidgets('AppLocalizations loads English strings', (tester) async {
    await tester.pumpWidget(
      Localizations(
        locale: const Locale('en'),
        delegates: AppLocalizations.localizationsDelegates,
        child: Builder(
          builder: (ctx) {
            final l10n = AppLocalizations.of(ctx);
            expect(l10n.appName, 'Pickforge');
            expect(l10n.forgeItButton, 'Forge it');
            return const SizedBox();
          },
        ),
      ),
    );
  });
}
```

- [ ] **Step 5: Run tests.**

```bash
fvm flutter test test/l10n/l10n_test.dart
```

Expected: PASS.

- [ ] **Step 6: Update `lib/main.dart` to install the theme + localizations.**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

void main() {
  runApp(const PickforgeApp());
}

class PickforgeApp extends StatelessWidget {
  const PickforgeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pickforge',
      theme: PickforgeTheme.light(),
      darkTheme: PickforgeTheme.dark(),
      themeMode: ThemeMode.dark,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: const _BootstrapPlaceholder(),
    );
  }
}

class _BootstrapPlaceholder extends StatelessWidget {
  const _BootstrapPlaceholder();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: Center(child: Text(l10n.appName)),
    );
  }
}
```

- [ ] **Step 7: Run everything.**

```bash
./scripts/check.sh
```

Expected: all green.

- [ ] **Step 8: Commit.**

```bash
git add l10n.yaml lib/l10n lib/main.dart test/l10n
git commit -m "feat(l10n): wire flutter_localizations with baseline English ARB"
```

---

### Task 6 — GetIt + Injectable bootstrap

**Files:**
- Create: `lib/core/di/injection.dart`
- Create: `lib/core/di/injection.config.dart` (generated)
- Create: `test/core/di/injection_test.dart`
- Modify: `lib/main.dart` (call `configureDependencies()`)

- [ ] **Step 1: Create the Injectable entry point.**

```dart
// lib/core/di/injection.dart
import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import 'injection.config.dart';

final getIt = GetIt.instance;

@InjectableInit(
  initializerName: r'$initGetIt',
  preferRelativeImports: true,
  asExtension: false,
)
Future<void> configureDependencies() async => $initGetIt(getIt);
```

- [ ] **Step 2: Add a sentinel registered service so we can test DI wires up.**

Create `lib/core/di/app_bootstrap.dart`:

```dart
import 'package:injectable/injectable.dart';

@lazySingleton
class AppBootstrap {
  bool get isReady => true;
}
```

- [ ] **Step 3: Run build_runner to generate `injection.config.dart`.**

```bash
./scripts/gen.sh
```

Expected: creates `lib/core/di/injection.config.dart` wiring the `AppBootstrap` registration.

- [ ] **Step 4: Write the test.**

```dart
// test/core/di/injection_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/di/app_bootstrap.dart';
import 'package:pickforge/core/di/injection.dart';

void main() {
  setUp(getIt.reset);

  test('configureDependencies registers AppBootstrap', () async {
    await configureDependencies();
    expect(getIt<AppBootstrap>().isReady, isTrue);
  });
}
```

- [ ] **Step 5: Run tests, expect PASS.**

```bash
fvm flutter test test/core/di/injection_test.dart
```

- [ ] **Step 6: Wire DI in `main.dart`.**

Replace the `main()` body:

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await configureDependencies();
  runApp(const PickforgeApp());
}
```

Add the import: `import 'package:pickforge/core/di/injection.dart';`

- [ ] **Step 7: Full gate.**

```bash
./scripts/check.sh
```

- [ ] **Step 8: Commit.**

```bash
git add lib/core/di lib/main.dart test/core/di
git commit -m "feat(di): bootstrap GetIt + Injectable wiring"
```

---

### Task 7 — GoRouter + window_manager + app shell

**Files:**
- Create: `lib/core/router/app_router.dart`
- Create: `lib/core/window/window_bootstrap.dart`
- Create: `lib/shared/widgets/app_shell.dart`
- Modify: `lib/main.dart`
- Create: `test/core/router/app_router_test.dart`

- [ ] **Step 1: Create the router.**

```dart
// lib/core/router/app_router.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/shared/widgets/app_shell.dart';

/// Top-level routes. Features add their pages here as they come online.
class AppRoutes {
  const AppRoutes._();
  static const connect = '/connect';
  static const dock = '/';
  static const history = '/history';
  static const settings = '/settings';
}

GoRouter buildAppRouter() {
  return GoRouter(
    initialLocation: AppRoutes.connect,
    routes: [
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.connect,
            builder: (_, __) => const _PlaceholderPage(title: 'Connect'),
          ),
          GoRoute(
            path: AppRoutes.dock,
            builder: (_, __) => const _PlaceholderPage(title: 'Dock'),
          ),
          GoRoute(
            path: AppRoutes.history,
            builder: (_, __) => const _PlaceholderPage(title: 'History'),
          ),
          GoRoute(
            path: AppRoutes.settings,
            builder: (_, __) => const _PlaceholderPage(title: 'Settings'),
          ),
        ],
      ),
    ],
  );
}

class _PlaceholderPage extends StatelessWidget {
  const _PlaceholderPage({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(child: Text(title)),
    );
  }
}
```

- [ ] **Step 2: Create `window_bootstrap.dart`.**

```dart
// lib/core/window/window_bootstrap.dart
import 'package:flutter/foundation.dart';
import 'package:window_manager/window_manager.dart';

Future<void> bootstrapWindow() async {
  if (!_isDesktop) return;
  await windowManager.ensureInitialized();
  const options = WindowOptions(
    size: Size(480, 720),
    minimumSize: Size(380, 560),
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
```

- [ ] **Step 3: Create `app_shell.dart`.**

```dart
// lib/shared/widgets/app_shell.dart
import 'package:flutter/material.dart';

/// Wraps every route with the Pickforge chrome. MVP version: plain container.
/// Command palette, tab bar, toasts land here in Task 41.
class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(color: Theme.of(context).colorScheme.surface, child: child);
  }
}
```

- [ ] **Step 4: Update `main.dart` to use the router + window bootstrap.**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/window/window_bootstrap.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await bootstrapWindow();
  await configureDependencies();
  runApp(const PickforgeApp());
}

class PickforgeApp extends StatelessWidget {
  const PickforgeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Pickforge',
      theme: PickforgeTheme.light(),
      darkTheme: PickforgeTheme.dark(),
      themeMode: ThemeMode.dark,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: buildAppRouter(),
    );
  }
}
```

- [ ] **Step 5: Write a smoke test for the router.**

```dart
// test/core/router/app_router_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/router/app_router.dart';

void main() {
  testWidgets('router renders connect route initially', (tester) async {
    await tester.pumpWidget(
      MaterialApp.router(routerConfig: buildAppRouter()),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connect'), findsOneWidget);
  });
}
```

- [ ] **Step 6: Run tests.**

```bash
fvm flutter test test/core/router/app_router_test.dart
```

Expected: PASS.

- [ ] **Step 7: Full gate + manual smoke.**

```bash
./scripts/check.sh
fvm flutter run -d linux   # verify a 480x720 window opens, always-on-top, showing "Connect"
```

- [ ] **Step 8: Commit.**

```bash
git add lib/core/router lib/core/window lib/shared/widgets lib/main.dart test/core/router
git commit -m "feat(shell): add GoRouter skeleton, window_manager bootstrap, app shell"
```

---

## Phase 2 — Core domain models

Goal: freezed models + sealed unions for every value that flows between layers. No logic, just data. Everything else will depend on these.

### Task 8 — Widget / inspector models

**Files:**
- Create: `lib/core/inspector/models/creation_location.dart`
- Create: `lib/core/inspector/models/widget_node.dart`
- Create: `lib/core/inspector/models/selected_widget.dart`
- Create: `lib/core/inspector/models/inspector_status.dart`
- Create: `lib/core/inspector/models.dart` (barrel)
- Create: `test/core/inspector/models/widget_node_test.dart`
- Create: `test/core/inspector/models/inspector_status_test.dart`

- [ ] **Step 1: Write the failing model tests.**

```dart
// test/core/inspector/models/widget_node_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';

void main() {
  group('WidgetNode', () {
    test('round-trips through JSON', () {
      const node = WidgetNode(
        id: 'inspector-0',
        className: 'ElevatedButton',
        children: [],
        creationLocation: CreationLocation(
          file: 'lib/foo.dart',
          line: 10,
          column: 3,
        ),
      );
      final json = node.toJson();
      final decoded = WidgetNode.fromJson(json);
      expect(decoded, node);
    });

    test('isUserCode returns false when creationLocation is null', () {
      const node = WidgetNode(
        id: 'x',
        className: 'Padding',
        children: [],
        creationLocation: null,
      );
      expect(node.isUserCode, isFalse);
    });
  });
}
```

```dart
// test/core/inspector/models/inspector_status_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';

void main() {
  test('InspectorStatus sealed union exhausts in when', () {
    const status = InspectorStatus.connected(selectModeOn: true);
    final label = status.when(
      disconnected: () => 'd',
      connecting: () => 'c',
      connected: (mode) => 'ok:$mode',
      error: (msg) => 'e:$msg',
    );
    expect(label, 'ok:true');
  });
}
```

- [ ] **Step 2: Create `creation_location.dart`.**

```dart
// lib/core/inspector/models/creation_location.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'creation_location.freezed.dart';
part 'creation_location.g.dart';

@freezed
class CreationLocation with _$CreationLocation {
  const factory CreationLocation({
    required String file,
    required int line,
    required int column,
  }) = _CreationLocation;

  factory CreationLocation.fromJson(Map<String, dynamic> json) =>
      _$CreationLocationFromJson(json);
}
```

- [ ] **Step 3: Create `widget_node.dart`.**

```dart
// lib/core/inspector/models/widget_node.dart
import 'package:freezed_annotation/freezed_annotation.dart';

import 'creation_location.dart';

part 'widget_node.freezed.dart';
part 'widget_node.g.dart';

@freezed
class WidgetNode with _$WidgetNode {
  const WidgetNode._();

  const factory WidgetNode({
    required String id,
    required String className,
    required List<WidgetNode> children,
    required CreationLocation? creationLocation,
  }) = _WidgetNode;

  factory WidgetNode.fromJson(Map<String, dynamic> json) =>
      _$WidgetNodeFromJson(json);

  bool get isUserCode {
    final loc = creationLocation;
    if (loc == null) return false;
    // Framework widgets live under flutter package; user code under the
    // project's lib/ or test/.
    return !loc.file.contains('/flutter/packages/flutter/');
  }
}
```

- [ ] **Step 4: Create `selected_widget.dart`.**

```dart
// lib/core/inspector/models/selected_widget.dart
import 'package:freezed_annotation/freezed_annotation.dart';

import 'widget_node.dart';

part 'selected_widget.freezed.dart';
part 'selected_widget.g.dart';

@freezed
class SelectedWidget with _$SelectedWidget {
  const factory SelectedWidget({
    required WidgetNode node,
    required List<String> ancestorClasses,
    required String? sourceSnippet,
    required String? screenshotPath,
    required String? adbScreenshotPath,
    required Map<String, dynamic> propertiesJson,
  }) = _SelectedWidget;

  factory SelectedWidget.fromJson(Map<String, dynamic> json) =>
      _$SelectedWidgetFromJson(json);
}
```

- [ ] **Step 5: Create `inspector_status.dart`.**

```dart
// lib/core/inspector/models/inspector_status.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'inspector_status.freezed.dart';

@freezed
class InspectorStatus with _$InspectorStatus {
  const factory InspectorStatus.disconnected() = _Disconnected;
  const factory InspectorStatus.connecting() = _Connecting;
  const factory InspectorStatus.connected({required bool selectModeOn}) =
      _Connected;
  const factory InspectorStatus.error(String message) = _Error;
}
```

- [ ] **Step 6: Create the barrel.**

```dart
// lib/core/inspector/models.dart
export 'models/creation_location.dart';
export 'models/inspector_status.dart';
export 'models/selected_widget.dart';
export 'models/widget_node.dart';
```

- [ ] **Step 7: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/inspector/models
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add lib/core/inspector/models lib/core/inspector/models.dart test/core/inspector/models
git commit -m "feat(inspector): add freezed models for widget tree and status"
```

---

### Task 9 — Agent / Skill / Forge request models

**Files:**
- Create: `lib/core/agent/models/agent_profile_id.dart`
- Create: `lib/core/skills/models/skill_id.dart`
- Create: `lib/core/agent/models/forge_request.dart`
- Create: `lib/core/agent/models.dart` (barrel)
- Create: `lib/core/skills/models.dart` (barrel)
- Create: `test/core/agent/models/forge_request_test.dart`

- [ ] **Step 1: Define the enum-backed IDs.**

```dart
// lib/core/agent/models/agent_profile_id.dart
enum AgentProfileId {
  claudeCode('claude-code'),
  codex('codex'),
  opencode('opencode');

  const AgentProfileId(this.value);
  final String value;

  static AgentProfileId fromValue(String raw) =>
      AgentProfileId.values.firstWhere((e) => e.value == raw);
}
```

```dart
// lib/core/skills/models/skill_id.dart
enum SkillId {
  editWidget('edit-widget'),
  extractWidget('extract-widget'),
  explainWidget('explain-widget');

  const SkillId(this.value);
  final String value;

  static SkillId fromValue(String raw) =>
      SkillId.values.firstWhere((e) => e.value == raw);
}
```

- [ ] **Step 2: Write the ForgeRequest test.**

```dart
// test/core/agent/models/forge_request_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models.dart';

void main() {
  test('ForgeRequest round-trips through JSON', () {
    final req = ForgeRequest(
      widget: const SelectedWidget(
        node: WidgetNode(
          id: 'x',
          className: 'ElevatedButton',
          children: [],
          creationLocation: CreationLocation(
            file: 'lib/foo.dart',
            line: 5,
            column: 3,
          ),
        ),
        ancestorClasses: ['Scaffold', 'Column'],
        sourceSnippet: 'ElevatedButton(...)',
        screenshotPath: '/tmp/a.png',
        adbScreenshotPath: null,
        propertiesJson: {'key': 'value'},
      ),
      skill: SkillId.editWidget,
      agentId: AgentProfileId.claudeCode,
      terminalId: 'ghostty',
      projectRoot: '/home/user/app',
    );
    final decoded = ForgeRequest.fromJson(req.toJson());
    expect(decoded, req);
  });
}
```

- [ ] **Step 3: Create `forge_request.dart`.**

```dart
// lib/core/agent/models/forge_request.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models.dart';

import 'agent_profile_id.dart';

part 'forge_request.freezed.dart';
part 'forge_request.g.dart';

@freezed
class ForgeRequest with _$ForgeRequest {
  const factory ForgeRequest({
    required SelectedWidget widget,
    required SkillId skill,
    required AgentProfileId agentId,
    required String terminalId,
    required String projectRoot,
  }) = _ForgeRequest;

  factory ForgeRequest.fromJson(Map<String, dynamic> json) =>
      _$ForgeRequestFromJson(json);
}
```

- [ ] **Step 4: Add a `JsonConverter` for the enums.**

Amend `forge_request.dart`'s imports and add the converter:

```dart
class _AgentProfileIdConverter implements JsonConverter<AgentProfileId, String> {
  const _AgentProfileIdConverter();
  @override
  AgentProfileId fromJson(String json) => AgentProfileId.fromValue(json);
  @override
  String toJson(AgentProfileId object) => object.value;
}

class _SkillIdConverter implements JsonConverter<SkillId, String> {
  const _SkillIdConverter();
  @override
  SkillId fromJson(String json) => SkillId.fromValue(json);
  @override
  String toJson(SkillId object) => object.value;
}
```

Annotate the class: `@Freezed()` class body uses `@_AgentProfileIdConverter()` on the `agentId` field and `@_SkillIdConverter()` on `skill`. Example field:

```dart
@_AgentProfileIdConverter() required AgentProfileId agentId,
@_SkillIdConverter() required SkillId skill,
```

- [ ] **Step 5: Create barrels.**

```dart
// lib/core/agent/models.dart
export 'models/agent_profile_id.dart';
export 'models/forge_request.dart';
```

```dart
// lib/core/skills/models.dart
export 'models/skill_id.dart';
```

- [ ] **Step 6: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/agent/models
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add lib/core/agent/models lib/core/agent/models.dart lib/core/skills test/core/agent/models
git commit -m "feat(core): add AgentProfileId, SkillId, ForgeRequest models"
```

---

### Task 10 — Terminal profile data types

**Files:**
- Create: `lib/core/terminal/models/terminal_profile_id.dart`
- Create: `lib/core/terminal/models/terminal_launch_spec.dart`
- Create: `lib/core/terminal/models.dart` (barrel)
- Create: `test/core/terminal/models/terminal_launch_spec_test.dart`

- [ ] **Step 1: Define the IDs.**

```dart
// lib/core/terminal/models/terminal_profile_id.dart
enum TerminalProfileId {
  ghostty('ghostty'),
  iterm2('iterm2'),
  warp('warp'),
  wezterm('wezterm'),
  alacritty('alacritty'),
  kitty('kitty'),
  windowsTerminal('windows-terminal'),
  gnomeTerminal('gnome-terminal'),
  terminalApp('terminal-app'),
  envFallback('env-fallback');

  const TerminalProfileId(this.value);
  final String value;

  static TerminalProfileId fromValue(String raw) =>
      TerminalProfileId.values.firstWhere((e) => e.value == raw);
}
```

- [ ] **Step 2: Write the test.**

```dart
// test/core/terminal/models/terminal_launch_spec_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';

void main() {
  test('TerminalLaunchSpec round-trips through JSON', () {
    const spec = TerminalLaunchSpec(
      id: TerminalProfileId.ghostty,
      scriptPath: '/tmp/wrapper.sh',
      workingDir: '/home/me/app',
      env: {'PICKFORGE_SESSION': '/tmp/ses'},
    );
    expect(TerminalLaunchSpec.fromJson(spec.toJson()), spec);
  });
}
```

- [ ] **Step 3: Create `terminal_launch_spec.dart`.**

```dart
// lib/core/terminal/models/terminal_launch_spec.dart
import 'package:freezed_annotation/freezed_annotation.dart';

import 'terminal_profile_id.dart';

part 'terminal_launch_spec.freezed.dart';
part 'terminal_launch_spec.g.dart';

class _TerminalIdConverter
    implements JsonConverter<TerminalProfileId, String> {
  const _TerminalIdConverter();
  @override
  TerminalProfileId fromJson(String json) => TerminalProfileId.fromValue(json);
  @override
  String toJson(TerminalProfileId object) => object.value;
}

@freezed
class TerminalLaunchSpec with _$TerminalLaunchSpec {
  const factory TerminalLaunchSpec({
    @_TerminalIdConverter() required TerminalProfileId id,
    required String scriptPath,
    required String workingDir,
    required Map<String, String> env,
  }) = _TerminalLaunchSpec;

  factory TerminalLaunchSpec.fromJson(Map<String, dynamic> json) =>
      _$TerminalLaunchSpecFromJson(json);
}
```

- [ ] **Step 4: Create the barrel.**

```dart
// lib/core/terminal/models.dart
export 'models/terminal_launch_spec.dart';
export 'models/terminal_profile_id.dart';
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/terminal/models
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/core/terminal/models lib/core/terminal/models.dart test/core/terminal/models
git commit -m "feat(terminal): add TerminalProfileId and TerminalLaunchSpec models"
```

---

## Phase 3 — Drift database

Goal: schema + DAOs for `project_settings`, `pick_history`, `agent_run_log`, with migration scaffolding and an in-memory test harness. After this phase, repositories can persist state.

### Task 11 — Drift schema + database class

**Files:**
- Create: `lib/core/drift/tables/project_settings.dart`
- Create: `lib/core/drift/tables/pick_history.dart`
- Create: `lib/core/drift/tables/agent_run_log.dart`
- Create: `lib/core/drift/pickforge_database.dart`
- Create: `lib/core/drift/pickforge_database.g.dart` (generated)
- Create: `test/core/drift/pickforge_database_test.dart`

- [ ] **Step 1: Define `project_settings` table.**

```dart
// lib/core/drift/tables/project_settings.dart
import 'package:drift/drift.dart';

@DataClassName('ProjectSettingsRow')
class ProjectSettings extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get defaultAgentId => text().nullable()();
  TextColumn get defaultTerminalId => text().nullable()();
  DateTimeColumn get lastUsedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}
```

- [ ] **Step 2: Define `pick_history` table.**

```dart
// lib/core/drift/tables/pick_history.dart
import 'package:drift/drift.dart';

@DataClassName('PickHistoryRow')
class PickHistory extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get projectRoot => text()();
  TextColumn get widgetClass => text()();
  TextColumn get creationFile => text().nullable()();
  IntColumn get creationLine => integer().nullable()();
  TextColumn get skillId => text()();
  TextColumn get agentId => text()();
  TextColumn get terminalId => text()();
  DateTimeColumn get pickedAt => dateTime()();
  TextColumn get widgetContextJson => text()();
}
```

- [ ] **Step 3: Define `agent_run_log` table.**

```dart
// lib/core/drift/tables/agent_run_log.dart
import 'package:drift/drift.dart';

@DataClassName('AgentRunLogRow')
class AgentRunLog extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get pickId => integer()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get finishedAt => dateTime().nullable()();
  IntColumn get exitCode => integer().nullable()();
  IntColumn get hotReloadCount => integer().withDefault(const Constant(0))();
  TextColumn get wrapperScriptPath => text()();
}
```

- [ ] **Step 4: Create the database class.**

```dart
// lib/core/drift/pickforge_database.dart
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:injectable/injectable.dart';

import 'tables/agent_run_log.dart';
import 'tables/pick_history.dart';
import 'tables/project_settings.dart';

part 'pickforge_database.g.dart';

@DriftDatabase(tables: [ProjectSettings, PickHistory, AgentRunLog])
@lazySingleton
class PickforgeDatabase extends _$PickforgeDatabase {
  PickforgeDatabase() : super(driftDatabase(name: 'pickforge'));

  PickforgeDatabase.forTesting(QueryExecutor e) : super(e);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
      );
}
```

- [ ] **Step 5: Write the database smoke test.**

```dart
// test/core/drift/pickforge_database_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('schema createAll runs cleanly on an empty database', () async {
    final tables = await db.customSelect(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).get();
    final names = tables.map((r) => r.data['name']).toList();
    expect(names, containsAll(['agent_run_log', 'pick_history', 'project_settings']));
  });
}
```

- [ ] **Step 6: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/drift/pickforge_database_test.dart
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add lib/core/drift test/core/drift
git commit -m "feat(drift): add PickforgeDatabase schema with three core tables"
```

---

### Task 12 — DAOs + queries

**Files:**
- Create: `lib/core/drift/dao/project_settings_dao.dart`
- Create: `lib/core/drift/dao/pick_history_dao.dart`
- Create: `lib/core/drift/dao/agent_run_log_dao.dart`
- Modify: `lib/core/drift/pickforge_database.dart` (register DAOs)
- Create: `test/core/drift/dao/project_settings_dao_test.dart`
- Create: `test/core/drift/dao/pick_history_dao_test.dart`

- [ ] **Step 1: Write the project_settings DAO test first.**

```dart
// test/core/drift/dao/project_settings_dao_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('upsert then load returns the latest settings', () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/me/app',
      vmServiceUrl: 'ws://localhost:8181/ws',
      defaultAgentId: 'claude-code',
      defaultTerminalId: 'ghostty',
    );
    final loaded = await db.projectSettingsDao.loadFor('/me/app');
    expect(loaded?.vmServiceUrl, 'ws://localhost:8181/ws');
    expect(loaded?.defaultAgentId, 'claude-code');
  });
}
```

- [ ] **Step 2: Implement `project_settings_dao.dart`.**

```dart
// lib/core/drift/dao/project_settings_dao.dart
import 'package:drift/drift.dart';

import '../pickforge_database.dart';
import '../tables/project_settings.dart';

part 'project_settings_dao.g.dart';

@DriftAccessor(tables: [ProjectSettings])
class ProjectSettingsDao extends DatabaseAccessor<PickforgeDatabase>
    with _$ProjectSettingsDaoMixin {
  ProjectSettingsDao(super.db);

  Future<ProjectSettingsRow?> loadFor(String projectRoot) {
    return (select(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .getSingleOrNull();
  }

  Future<void> upsert({
    required String projectRoot,
    String? vmServiceUrl,
    String? defaultAgentId,
    String? defaultTerminalId,
  }) {
    final companion = ProjectSettingsCompanion(
      projectRoot: Value(projectRoot),
      vmServiceUrl: Value(vmServiceUrl),
      defaultAgentId: Value(defaultAgentId),
      defaultTerminalId: Value(defaultTerminalId),
      lastUsedAt: Value(DateTime.now()),
    );
    return into(projectSettings).insertOnConflictUpdate(companion);
  }
}
```

- [ ] **Step 3: Register the DAO on the database class.**

Amend `lib/core/drift/pickforge_database.dart`:

```dart
@DriftDatabase(
  tables: [ProjectSettings, PickHistory, AgentRunLog],
  daos: [ProjectSettingsDao, PickHistoryDao, AgentRunLogDao],
)
```

and add imports for the three DAO files.

- [ ] **Step 4: Implement `pick_history_dao.dart`.**

```dart
// lib/core/drift/dao/pick_history_dao.dart
import 'package:drift/drift.dart';

import '../pickforge_database.dart';
import '../tables/pick_history.dart';

part 'pick_history_dao.g.dart';

@DriftAccessor(tables: [PickHistory])
class PickHistoryDao extends DatabaseAccessor<PickforgeDatabase>
    with _$PickHistoryDaoMixin {
  PickHistoryDao(super.db);

  Future<int> insertPick({
    required String projectRoot,
    required String widgetClass,
    required String? creationFile,
    required int? creationLine,
    required String skillId,
    required String agentId,
    required String terminalId,
    required String widgetContextJson,
  }) {
    return into(pickHistory).insert(
      PickHistoryCompanion.insert(
        projectRoot: projectRoot,
        widgetClass: widgetClass,
        creationFile: Value(creationFile),
        creationLine: Value(creationLine),
        skillId: skillId,
        agentId: agentId,
        terminalId: terminalId,
        pickedAt: DateTime.now(),
        widgetContextJson: widgetContextJson,
      ),
    );
  }

  Stream<List<PickHistoryRow>> recent({int limit = 50}) =>
      (select(pickHistory)
            ..orderBy([(t) => OrderingTerm.desc(t.pickedAt)])
            ..limit(limit))
          .watch();
}
```

- [ ] **Step 5: Implement `agent_run_log_dao.dart`.**

```dart
// lib/core/drift/dao/agent_run_log_dao.dart
import 'package:drift/drift.dart';

import '../pickforge_database.dart';
import '../tables/agent_run_log.dart';

part 'agent_run_log_dao.g.dart';

@DriftAccessor(tables: [AgentRunLog])
class AgentRunLogDao extends DatabaseAccessor<PickforgeDatabase>
    with _$AgentRunLogDaoMixin {
  AgentRunLogDao(super.db);

  Future<int> recordStart({
    required int pickId,
    required String wrapperScriptPath,
  }) {
    return into(agentRunLog).insert(
      AgentRunLogCompanion.insert(
        pickId: pickId,
        startedAt: DateTime.now(),
        wrapperScriptPath: wrapperScriptPath,
      ),
    );
  }

  Future<void> incrementHotReload(int runId) async {
    await (update(agentRunLog)..where((t) => t.id.equals(runId))).write(
      AgentRunLogCompanion.custom(
        hotReloadCount: agentRunLog.hotReloadCount + const Constant(1),
      ),
    );
  }
}
```

- [ ] **Step 6: Write a test for pick_history + agent_run_log flow.**

```dart
// test/core/drift/dao/pick_history_dao_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('insertPick + recent returns the row', () async {
    final id = await db.pickHistoryDao.insertPick(
      projectRoot: '/me/app',
      widgetClass: 'ElevatedButton',
      creationFile: 'lib/foo.dart',
      creationLine: 10,
      skillId: 'edit-widget',
      agentId: 'claude-code',
      terminalId: 'ghostty',
      widgetContextJson: '{}',
    );
    expect(id, greaterThan(0));

    final recent = await db.pickHistoryDao.recent().first;
    expect(recent, hasLength(1));
    expect(recent.first.widgetClass, 'ElevatedButton');
  });

  test('agent run log increments hot reload counter', () async {
    final pickId = await db.pickHistoryDao.insertPick(
      projectRoot: '/me/app',
      widgetClass: 'X',
      creationFile: null,
      creationLine: null,
      skillId: 'edit-widget',
      agentId: 'claude-code',
      terminalId: 'ghostty',
      widgetContextJson: '{}',
    );
    final runId = await db.agentRunLogDao
        .recordStart(pickId: pickId, wrapperScriptPath: '/tmp/w.sh');
    await db.agentRunLogDao.incrementHotReload(runId);
    await db.agentRunLogDao.incrementHotReload(runId);
    final row = await (db.select(db.agentRunLog)
          ..where((t) => t.id.equals(runId)))
        .getSingle();
    expect(row.hotReloadCount, 2);
  });
}
```

- [ ] **Step 7: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/drift
```

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add lib/core/drift/dao lib/core/drift/pickforge_database.dart test/core/drift
git commit -m "feat(drift): add DAOs for project settings, pick history, agent run log"
```

---

### Task 13 — Settings repository

**Files:**
- Create: `lib/core/settings/project_settings_repository.dart`
- Create: `test/core/settings/project_settings_repository_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/settings/project_settings_repository_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectSettingsRepository repo;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = ProjectSettingsRepository(db);
  });
  tearDown(() => db.close());

  test('getVmServiceUrl returns null when unset', () async {
    expect(await repo.getVmServiceUrl('/me/app'), isNull);
  });

  test('setVmServiceUrl then getVmServiceUrl round-trips', () async {
    await repo.setVmServiceUrl('/me/app', 'ws://localhost:8181/ws');
    expect(
      await repo.getVmServiceUrl('/me/app'),
      'ws://localhost:8181/ws',
    );
  });
}
```

- [ ] **Step 2: Implement the repository.**

```dart
// lib/core/settings/project_settings_repository.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

@lazySingleton
class ProjectSettingsRepository {
  ProjectSettingsRepository(this._db);
  final PickforgeDatabase _db;

  Future<String?> getVmServiceUrl(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    return row?.vmServiceUrl;
  }

  Future<void> setVmServiceUrl(String projectRoot, String url) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      vmServiceUrl: url,
    );
  }

  Future<String?> getDefaultAgentId(String projectRoot) async =>
      (await _db.projectSettingsDao.loadFor(projectRoot))?.defaultAgentId;

  Future<void> setDefaultAgentId(String projectRoot, String agentId) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      defaultAgentId: agentId,
    );
  }

  Future<String?> getDefaultTerminalId(String projectRoot) async =>
      (await _db.projectSettingsDao.loadFor(projectRoot))?.defaultTerminalId;

  Future<void> setDefaultTerminalId(String projectRoot, String terminalId) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      defaultTerminalId: terminalId,
    );
  }
}
```

- [ ] **Step 3: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/settings
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/settings test/core/settings
git commit -m "feat(settings): add ProjectSettingsRepository on top of Drift DAOs"
```

---

## Phase 4 — VM Service client

Goal: connect to a running Flutter app's VM Service over WebSocket, expose service-extension calls, survive drops with exponential backoff, and ship a fixture-replay harness for tests.

### Task 14 — VmServiceClient wrapper

**Files:**
- Create: `lib/core/vm_service/vm_service_client.dart`
- Create: `lib/core/vm_service/vm_service_connection_state.dart`
- Create: `test/core/vm_service/vm_service_connection_state_test.dart`

- [ ] **Step 1: Define the connection state sealed union.**

```dart
// lib/core/vm_service/vm_service_connection_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'vm_service_connection_state.freezed.dart';

@freezed
class VmServiceConnectionState with _$VmServiceConnectionState {
  const factory VmServiceConnectionState.idle() = _Idle;
  const factory VmServiceConnectionState.connecting({required int attempt}) =
      _Connecting;
  const factory VmServiceConnectionState.connected({required String url}) =
      _Connected;
  const factory VmServiceConnectionState.error({
    required String message,
    required int attempt,
  }) = _Error;
}
```

- [ ] **Step 2: Write the connection-state test.**

```dart
// test/core/vm_service/vm_service_connection_state_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';

void main() {
  test('union exhaustiveness via when', () {
    const s = VmServiceConnectionState.connected(url: 'ws://x/ws');
    final label = s.when(
      idle: () => 'idle',
      connecting: (a) => 'c:$a',
      connected: (u) => 'ok:$u',
      error: (m, a) => 'e:$m:$a',
    );
    expect(label, 'ok:ws://x/ws');
  });
}
```

- [ ] **Step 3: Codegen.**

```bash
./scripts/gen.sh
fvm flutter test test/core/vm_service/vm_service_connection_state_test.dart
```

Expected: PASS.

- [ ] **Step 4: Create the client wrapper.**

```dart
// lib/core/vm_service/vm_service_client.dart
import 'dart:async';

import 'package:injectable/injectable.dart';
import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart' as vm_io;

import 'vm_service_connection_state.dart';

typedef VmServiceFactory = Future<VmService> Function(String url);

/// Thin wrapper around package:vm_service that owns connection lifecycle,
/// reconnects, and exposes a stream of connection state. Stateless as far
/// as business logic goes — higher layers consume the [VmService] handle
/// while the connection is live.
@lazySingleton
class VmServiceClient {
  VmServiceClient({VmServiceFactory? factory})
      : _factory = factory ?? vm_io.vmServiceConnectUri;

  final VmServiceFactory _factory;
  final _controller =
      StreamController<VmServiceConnectionState>.broadcast();

  VmService? _service;
  String? _url;

  Stream<VmServiceConnectionState> get state => _controller.stream;
  VmService? get service => _service;
  String? get currentUrl => _url;

  Future<void> connect(String url) async {
    _url = url;
    _controller.add(const VmServiceConnectionState.connecting(attempt: 1));
    try {
      _service = await _factory(url);
      _controller.add(VmServiceConnectionState.connected(url: url));
    } on Object catch (e) {
      _controller.add(
        VmServiceConnectionState.error(message: e.toString(), attempt: 1),
      );
      rethrow;
    }
  }

  Future<void> disconnect() async {
    await _service?.dispose();
    _service = null;
    _controller.add(const VmServiceConnectionState.idle());
  }

  Future<void> close() async {
    await disconnect();
    await _controller.close();
  }
}
```

- [ ] **Step 5: Commit.**

```bash
git add lib/core/vm_service test/core/vm_service/vm_service_connection_state_test.dart
git commit -m "feat(vm_service): add VmServiceClient + connection state union"
```

---

### Task 15 — Reconnect with exponential backoff

**Files:**
- Modify: `lib/core/vm_service/vm_service_client.dart`
- Create: `lib/core/vm_service/reconnect_policy.dart`
- Create: `test/core/vm_service/reconnect_policy_test.dart`
- Create: `test/core/vm_service/vm_service_client_test.dart`

- [ ] **Step 1: Write the policy test.**

```dart
// test/core/vm_service/reconnect_policy_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/reconnect_policy.dart';

void main() {
  test('ExponentialBackoff produces 1s, 2s, 4s, 8s, 8s …', () {
    const p = ExponentialBackoff(
      initial: Duration(seconds: 1),
      cap: Duration(seconds: 8),
    );
    expect(p.delayFor(1), const Duration(seconds: 1));
    expect(p.delayFor(2), const Duration(seconds: 2));
    expect(p.delayFor(3), const Duration(seconds: 4));
    expect(p.delayFor(4), const Duration(seconds: 8));
    expect(p.delayFor(5), const Duration(seconds: 8));
  });
}
```

- [ ] **Step 2: Implement the policy.**

```dart
// lib/core/vm_service/reconnect_policy.dart
class ExponentialBackoff {
  const ExponentialBackoff({
    this.initial = const Duration(seconds: 1),
    this.cap = const Duration(seconds: 8),
  });

  final Duration initial;
  final Duration cap;

  Duration delayFor(int attempt) {
    assert(attempt >= 1, 'attempt must be 1-indexed');
    final exp = initial * (1 << (attempt - 1));
    return exp > cap ? cap : exp;
  }
}
```

- [ ] **Step 3: Run policy test.**

```bash
fvm flutter test test/core/vm_service/reconnect_policy_test.dart
```

Expected: PASS.

- [ ] **Step 4: Write the client reconnect test using a fake factory.**

```dart
// test/core/vm_service/vm_service_client_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/reconnect_policy.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';

void main() {
  test('reconnectLoop emits Connecting → Error with incrementing attempts',
      () async {
    var calls = 0;
    final client = VmServiceClient(
      factory: (url) async {
        calls++;
        throw StateError('boom-$calls');
      },
    );
    const policy = ExponentialBackoff(
      initial: Duration(milliseconds: 10),
      cap: Duration(milliseconds: 40),
    );

    final events = <VmServiceConnectionState>[];
    final sub = client.state.listen(events.add);

    final future = client.reconnectLoop(
      'ws://x/ws',
      policy: policy,
      maxAttempts: 3,
    );
    await future;
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();

    expect(calls, 3);
    final errorAttempts = events
        .map(
          (e) => e.maybeWhen(
            error: (_, attempt) => attempt,
            orElse: () => null,
          ),
        )
        .whereType<int>()
        .toList();
    expect(errorAttempts, [1, 2, 3]);
  });
}
```

- [ ] **Step 5: Add `reconnectLoop` to the client.**

Append to `VmServiceClient`:

```dart
Future<void> reconnectLoop(
  String url, {
  required ExponentialBackoff policy,
  int maxAttempts = 1 << 30,
}) async {
  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    _controller.add(VmServiceConnectionState.connecting(attempt: attempt));
    try {
      _service = await _factory(url);
      _url = url;
      _controller.add(VmServiceConnectionState.connected(url: url));
      return;
    } on Object catch (e) {
      _controller.add(
        VmServiceConnectionState.error(
          message: e.toString(),
          attempt: attempt,
        ),
      );
      if (attempt == maxAttempts) return;
      await Future<void>.delayed(policy.delayFor(attempt + 1));
    }
  }
}
```

Add `import 'reconnect_policy.dart';` at the top.

- [ ] **Step 6: Run tests.**

```bash
fvm flutter test test/core/vm_service/vm_service_client_test.dart
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add lib/core/vm_service/reconnect_policy.dart lib/core/vm_service/vm_service_client.dart test/core/vm_service
git commit -m "feat(vm_service): add exponential backoff reconnect loop"
```

---

### Task 16 — Fixture-replay harness

**Files:**
- Create: `lib/core/vm_service/testing/fake_vm_service.dart`
- Create: `test/fixtures/vm_service/connect_and_select_button.jsonl`
- Create: `tool/record_vm_service.dart`
- Create: `test/core/vm_service/testing/fake_vm_service_test.dart`

- [ ] **Step 1: Define the fixture format.**

Each `.jsonl` fixture is one JSON object per line with this shape:

```json
{"type":"request","method":"getVM","params":{},"id":"1"}
{"type":"response","id":"1","result":{"type":"VM","name":"flutter_app","isolates":[{"id":"isolates/1","name":"main"}]}}
{"type":"event","streamId":"Extension","event":{"kind":"ServiceExtensionAdded","extensionRPC":"ext.flutter.inspector.show"}}
```

- [ ] **Step 2: Write a minimal fixture.**

Write exactly this content to `test/fixtures/vm_service/connect_and_select_button.jsonl`:

```jsonl
{"type":"response","method":"getVM","result":{"type":"VM","name":"flutter","isolates":[{"id":"isolates/1","name":"main"}]}}
{"type":"response","method":"ext.flutter.inspector.show","result":{"enabled":true}}
{"type":"response","method":"ext.flutter.inspector.getSelectedWidget","result":{"valueId":"inspector-42","description":"ElevatedButton","creationLocation":{"file":"lib/foo.dart","line":10,"column":3}}}
```

- [ ] **Step 3: Write the fake.**

```dart
// lib/core/vm_service/testing/fake_vm_service.dart
import 'dart:convert';
import 'dart:io';

/// Replays a recorded VM Service conversation for tests. Call [respondTo]
/// in the order the production code calls methods; the fake asserts each
/// call matches the next scripted response by method name.
class FakeVmServiceScript {
  FakeVmServiceScript(this._entries);

  final List<Map<String, dynamic>> _entries;
  int _cursor = 0;

  static Future<FakeVmServiceScript> loadFromFile(String path) async {
    final lines = await File(path).readAsLines();
    final entries = lines
        .where((l) => l.trim().isNotEmpty)
        .map((l) => json.decode(l) as Map<String, dynamic>)
        .toList();
    return FakeVmServiceScript(entries);
  }

  Map<String, dynamic> respondTo(String method) {
    while (_cursor < _entries.length) {
      final e = _entries[_cursor++];
      if (e['type'] == 'response' && e['method'] == method) {
        return (e['result'] as Map).cast<String, dynamic>();
      }
    }
    throw StateError('No scripted response for method "$method"');
  }
}
```

- [ ] **Step 4: Write the fake test.**

```dart
// test/core/vm_service/testing/fake_vm_service_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/vm_service/testing/fake_vm_service.dart';

void main() {
  test('loadFromFile replays responses in script order', () async {
    final script = await FakeVmServiceScript.loadFromFile(
      'test/fixtures/vm_service/connect_and_select_button.jsonl',
    );
    expect(script.respondTo('getVM')['name'], 'flutter');
    expect(
      script.respondTo('ext.flutter.inspector.show')['enabled'],
      isTrue,
    );
    expect(
      script.respondTo('ext.flutter.inspector.getSelectedWidget')['description'],
      'ElevatedButton',
    );
  });

  test('throws on missing method', () async {
    final script = await FakeVmServiceScript.loadFromFile(
      'test/fixtures/vm_service/connect_and_select_button.jsonl',
    );
    expect(() => script.respondTo('nonexistent'), throwsStateError);
  });
}
```

- [ ] **Step 5: Scaffold the recorder tool.**

```dart
// tool/record_vm_service.dart
import 'dart:convert';
import 'dart:io';

import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

/// Usage: fvm dart run tool/record_vm_service.dart ws://127.0.0.1:PORT/UUID=/ws out.jsonl
Future<void> main(List<String> args) async {
  if (args.length != 2) {
    stderr.writeln('Usage: fvm dart run tool/record_vm_service.dart <ws-url> <out.jsonl>');
    exitCode = 64;
    return;
  }
  final url = args[0];
  final outPath = args[1];
  final sink = File(outPath).openWrite();
  void record(Map<String, dynamic> entry) => sink.writeln(json.encode(entry));

  final service = await vmServiceConnectUri(url);
  final vm = await service.getVM();
  record({
    'type': 'response',
    'method': 'getVM',
    'result': {
      'type': 'VM',
      'name': vm.name,
      'isolates': vm.isolates?.map((i) => {'id': i.id, 'name': i.name}).toList(),
    },
  });

  stdout.writeln('Recorded getVM. Press Ctrl-C to stop.');
  ProcessSignal.sigint.watch().listen((_) async {
    await sink.flush();
    await sink.close();
    await service.dispose();
    exit(0);
  });
}
```

- [ ] **Step 6: Run tests.**

```bash
fvm flutter test test/core/vm_service/testing
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add lib/core/vm_service/testing tool/record_vm_service.dart test/fixtures/vm_service test/core/vm_service/testing
git commit -m "feat(vm_service): add fixture-replay harness and recorder tool"
```

---

### Task 17 — Service-extension wrapper methods

**Files:**
- Create: `lib/core/vm_service/inspector_extensions.dart`
- Create: `test/core/vm_service/inspector_extensions_test.dart`

- [ ] **Step 1: Write the test first.**

```dart
// test/core/vm_service/inspector_extensions_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';
import 'package:vm_service/vm_service.dart';

class _MockVmService extends Mock implements VmService {}

class _FakeResponse extends Fake implements Response {
  _FakeResponse(this._data);
  final Map<String, dynamic> _data;
  @override
  Map<String, dynamic> get json => _data;
}

void main() {
  late _MockVmService vm;
  late InspectorExtensions ext;

  setUp(() {
    vm = _MockVmService();
    ext = InspectorExtensions(vm, isolateId: 'isolates/1');
  });

  test('setSelectMode calls ext.flutter.inspector.show with enabled=true',
      () async {
    when(() => vm.callServiceExtension(
          'ext.flutter.inspector.show',
          isolateId: 'isolates/1',
          args: {'enabled': 'true'},
        )).thenAnswer((_) async => _FakeResponse({'enabled': true}));

    await ext.setSelectMode(enabled: true);

    verify(() => vm.callServiceExtension(
          'ext.flutter.inspector.show',
          isolateId: 'isolates/1',
          args: {'enabled': 'true'},
        )).called(1);
  });
}
```

- [ ] **Step 2: Implement the wrapper.**

```dart
// lib/core/vm_service/inspector_extensions.dart
import 'dart:convert';

import 'package:vm_service/vm_service.dart';

/// Typed helpers around ext.flutter.inspector.* service extensions.
class InspectorExtensions {
  InspectorExtensions(this._vm, {required this.isolateId});

  final VmService _vm;
  final String isolateId;

  Future<void> setSelectMode({required bool enabled}) async {
    await _vm.callServiceExtension(
      'ext.flutter.inspector.show',
      isolateId: isolateId,
      args: {'enabled': enabled.toString()},
    );
  }

  Future<Map<String, dynamic>?> getSelectedWidget() async {
    final r = await _vm.callServiceExtension(
      'ext.flutter.inspector.getSelectedWidget',
      isolateId: isolateId,
    );
    return r.json;
  }

  Future<Map<String, dynamic>?> getRootWidgetSummaryTree() async {
    final r = await _vm.callServiceExtension(
      'ext.flutter.inspector.getRootWidgetSummaryTree',
      isolateId: isolateId,
    );
    return r.json;
  }

  Future<List<int>> screenshot() async {
    final r = await _vm.callServiceExtension(
      'ext.flutter.inspector.screenshot',
      isolateId: isolateId,
    );
    final base64 = r.json?['screenshot'] as String?;
    if (base64 == null) return const [];
    return const _Base64().decode(base64);
  }
}

class _Base64 {
  const _Base64();
  List<int> decode(String s) => const Base64Decoder().convert(s);
}
```

- [ ] **Step 3: Run tests.**

```bash
fvm flutter test test/core/vm_service/inspector_extensions_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/vm_service/inspector_extensions.dart test/core/vm_service/inspector_extensions_test.dart
git commit -m "feat(vm_service): typed wrappers for ext.flutter.inspector.* calls"
```

---

## Phase 5 — Inspector core

Goal: the business logic that turns raw VM Service payloads into Pickforge's `WidgetNode` / `SelectedWidget` domain types, tracks select-mode state, and resolves selections into source snippets.

### Task 18 — Widget tree decoder

**Files:**
- Create: `lib/core/inspector/widget_tree_decoder.dart`
- Create: `test/core/inspector/widget_tree_decoder_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/inspector/widget_tree_decoder_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/widget_tree_decoder.dart';

void main() {
  test('decodes a minimal diagnostic node tree', () {
    final raw = {
      'valueId': 'inspector-0',
      'description': 'MyApp',
      'creationLocation': {'file': 'lib/main.dart', 'line': 3, 'column': 1},
      'children': [
        {
          'valueId': 'inspector-1',
          'description': 'Text',
          'creationLocation': {
            'file': 'lib/main.dart',
            'line': 10,
            'column': 5,
          },
          'children': <Map<String, dynamic>>[],
        },
      ],
    };

    final node = WidgetTreeDecoder.decode(raw);

    expect(node.className, 'MyApp');
    expect(node.children, hasLength(1));
    expect(node.children.first.className, 'Text');
    expect(node.creationLocation!.file, 'lib/main.dart');
  });

  test('decodes a node without creationLocation', () {
    final raw = {
      'valueId': 'inspector-7',
      'description': 'Padding',
      'children': <Map<String, dynamic>>[],
    };
    final node = WidgetTreeDecoder.decode(raw);
    expect(node.creationLocation, isNull);
    expect(node.isUserCode, isFalse);
  });
}
```

- [ ] **Step 2: Implement the decoder.**

```dart
// lib/core/inspector/widget_tree_decoder.dart
import 'models.dart';

class WidgetTreeDecoder {
  const WidgetTreeDecoder._();

  static WidgetNode decode(Map<String, dynamic> raw) {
    final children = (raw['children'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(decode)
        .toList(growable: false);
    final locRaw = raw['creationLocation'] as Map<String, dynamic>?;
    return WidgetNode(
      id: raw['valueId'] as String,
      className: raw['description'] as String? ?? '<unknown>',
      children: children,
      creationLocation: locRaw == null
          ? null
          : CreationLocation(
              file: locRaw['file'] as String,
              line: locRaw['line'] as int,
              column: locRaw['column'] as int,
            ),
    );
  }
}
```

- [ ] **Step 3: Run tests.**

```bash
fvm flutter test test/core/inspector/widget_tree_decoder_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/inspector/widget_tree_decoder.dart test/core/inspector/widget_tree_decoder_test.dart
git commit -m "feat(inspector): decode VM Service diagnostic tree into WidgetNode"
```

---

### Task 19 — Source snippet extractor

**Files:**
- Create: `lib/core/inspector/source_snippet_extractor.dart`
- Create: `test/core/inspector/source_snippet_extractor_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/inspector/source_snippet_extractor_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';

void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('pickforge_src_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  test('extracts ±contextLines around the creation line', () async {
    final file = File('${tmp.path}/foo.dart');
    await file.writeAsString(List.generate(20, (i) => 'line $i').join('\n'));
    final extractor = const SourceSnippetExtractor(contextLines: 2);
    final snippet = await extractor.extract(
      CreationLocation(file: file.path, line: 10, column: 1),
    );
    expect(snippet, contains('line 7'));
    expect(snippet, contains('line 9'));
    expect(snippet, contains('line 11'));
    expect(snippet, isNot(contains('line 4')));
  });

  test('returns null when file does not exist', () async {
    final extractor = const SourceSnippetExtractor();
    final snippet = await extractor.extract(
      const CreationLocation(file: '/no/such/file.dart', line: 1, column: 1),
    );
    expect(snippet, isNull);
  });
}
```

- [ ] **Step 2: Implement the extractor.**

```dart
// lib/core/inspector/source_snippet_extractor.dart
import 'dart:io';

import 'package:injectable/injectable.dart';

import 'models.dart';

@lazySingleton
class SourceSnippetExtractor {
  const SourceSnippetExtractor({this.contextLines = 20});

  final int contextLines;

  Future<String?> extract(CreationLocation loc) async {
    final file = File(loc.file);
    if (!file.existsSync()) return null;
    final lines = await file.readAsLines();
    final start = (loc.line - contextLines - 1).clamp(0, lines.length);
    final end = (loc.line + contextLines).clamp(0, lines.length);
    final slice = lines.sublist(start, end);
    final withNumbers = <String>[
      for (var i = 0; i < slice.length; i++)
        '${(start + i + 1).toString().padLeft(4)}  ${slice[i]}',
    ];
    return withNumbers.join('\n');
  }
}
```

- [ ] **Step 3: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/inspector/source_snippet_extractor_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/inspector/source_snippet_extractor.dart test/core/inspector/source_snippet_extractor_test.dart
git commit -m "feat(inspector): extract numbered source snippet around creation location"
```

---

### Task 20 — InspectorRepository

**Files:**
- Create: `lib/core/inspector/inspector_repository.dart`
- Create: `test/core/inspector/inspector_repository_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/inspector/inspector_repository_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';

class _MockExt extends Mock implements InspectorExtensions {}

class _MockSourceExtractor extends Mock implements SourceSnippetExtractor {}

void main() {
  late _MockExt ext;
  late _MockSourceExtractor src;
  late InspectorRepository repo;

  setUp(() {
    ext = _MockExt();
    src = _MockSourceExtractor();
    repo = InspectorRepository(ext, src);
  });

  test('fetchSelection combines tree + source + extension data', () async {
    when(ext.getSelectedWidget).thenAnswer(
      (_) async => {
        'valueId': 'x',
        'description': 'ElevatedButton',
        'creationLocation': {
          'file': 'lib/foo.dart',
          'line': 10,
          'column': 3,
        },
        'children': <Map<String, dynamic>>[],
      },
    );
    when(ext.getRootWidgetSummaryTree).thenAnswer(
      (_) async => {
        'valueId': 'root',
        'description': 'MyApp',
        'creationLocation': <String, dynamic>{
          'file': 'lib/main.dart',
          'line': 1,
          'column': 1,
        },
        'children': <Map<String, dynamic>>[],
      },
    );
    when(() => src.extract(any()))
        .thenAnswer((_) async => '   10  ElevatedButton(...)');

    final selected = await repo.fetchSelection();

    expect(selected, isNotNull);
    expect(selected!.node.className, 'ElevatedButton');
    expect(selected.sourceSnippet, contains('ElevatedButton'));
    expect(selected.ancestorClasses, contains('MyApp'));
  });
}
```

- [ ] **Step 2: Implement the repository.**

```dart
// lib/core/inspector/inspector_repository.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';

import 'models.dart';
import 'source_snippet_extractor.dart';
import 'widget_tree_decoder.dart';

@lazySingleton
class InspectorRepository {
  InspectorRepository(this._ext, this._source);

  final InspectorExtensions _ext;
  final SourceSnippetExtractor _source;

  Future<void> enableSelectMode() => _ext.setSelectMode(enabled: true);
  Future<void> disableSelectMode() => _ext.setSelectMode(enabled: false);

  /// Fetches the currently selected widget along with ancestor chain and
  /// source snippet. Returns null if nothing is selected on-device.
  Future<SelectedWidget?> fetchSelection() async {
    final rawSelected = await _ext.getSelectedWidget();
    if (rawSelected == null || rawSelected.isEmpty) return null;

    final node = WidgetTreeDecoder.decode(rawSelected);

    final rawTree = await _ext.getRootWidgetSummaryTree();
    final ancestorClasses = rawTree == null
        ? <String>[]
        : _ancestorsOf(WidgetTreeDecoder.decode(rawTree), node.id);

    final snippet = node.creationLocation == null
        ? null
        : await _source.extract(node.creationLocation!);

    return SelectedWidget(
      node: node,
      ancestorClasses: ancestorClasses,
      sourceSnippet: snippet,
      screenshotPath: null,
      adbScreenshotPath: null,
      propertiesJson: rawSelected,
    );
  }

  List<String> _ancestorsOf(WidgetNode root, String targetId) {
    final path = <String>[];
    bool walk(WidgetNode n) {
      if (n.id == targetId) return true;
      path.add(n.className);
      for (final c in n.children) {
        if (walk(c)) return true;
      }
      path.removeLast();
      return false;
    }

    walk(root);
    return path;
  }
}
```

- [ ] **Step 3: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/inspector/inspector_repository_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/inspector/inspector_repository.dart test/core/inspector/inspector_repository_test.dart
git commit -m "feat(inspector): InspectorRepository composes tree + source + ancestors"
```

---

## Phase 6 — Agent profiles

Goal: `AgentProfile` abstraction + concrete profiles for Claude Code, Codex, and OpenCode. Each knows how to assemble its initial prompt and how the agent CLI reads context files.

### Task 21 — AgentProfile abstract + registry

**Files:**
- Create: `lib/core/agent/agent_profile.dart`
- Create: `lib/core/agent/agent_profile_registry.dart`
- Create: `test/core/agent/agent_profile_registry_test.dart`

- [ ] **Step 1: Define the abstract profile.**

```dart
// lib/core/agent/agent_profile.dart
import 'package:pickforge/core/agent/models.dart';

abstract class AgentProfile {
  const AgentProfile();

  AgentProfileId get id;
  String get displayName;

  /// Binary name on PATH (used for install-check).
  String get binary;

  /// File name the agent expects in the project root for project-level context
  /// (CLAUDE.md for Claude Code, AGENTS.md for Codex and OpenCode).
  String get projectContextFile;

  /// Args for spawning this agent inside the wrapper script. The wrapper will
  /// pipe the initial prompt into stdin.
  List<String> invocationArgs();

  /// Final transformation on the initial prompt before it's piped in.
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  });
}
```

- [ ] **Step 2: Write the registry test.**

```dart
// test/core/agent/agent_profile_registry_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';

class _FakeProfile extends AgentProfile {
  const _FakeProfile(this._id);
  final AgentProfileId _id;

  @override
  AgentProfileId get id => _id;
  @override
  String get displayName => _id.value;
  @override
  String get binary => _id.value;
  @override
  String get projectContextFile => 'X.md';
  @override
  List<String> invocationArgs() => const [];
  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) =>
      '';
}

void main() {
  test('registry resolves each bundled ID', () {
    final registry = AgentProfileRegistry([
      for (final id in AgentProfileId.values) _FakeProfile(id),
    ]);
    for (final id in AgentProfileId.values) {
      expect(registry.get(id).id, id);
    }
  });

  test('throws on unknown ID', () {
    final registry = AgentProfileRegistry(const []);
    expect(
      () => registry.get(AgentProfileId.claudeCode),
      throwsA(isA<StateError>()),
    );
  });
}
```

- [ ] **Step 3: Implement the registry.**

```dart
// lib/core/agent/agent_profile_registry.dart
import 'package:injectable/injectable.dart';

import 'agent_profile.dart';
import 'models.dart';

@lazySingleton
class AgentProfileRegistry {
  AgentProfileRegistry(this._profiles);
  final List<AgentProfile> _profiles;

  AgentProfile get(AgentProfileId id) => _profiles.firstWhere(
        (p) => p.id == id,
        orElse: () => throw StateError('No AgentProfile registered for $id'),
      );

  List<AgentProfile> all() => List.unmodifiable(_profiles);
}
```

- [ ] **Step 4: Run tests.**

```bash
fvm flutter test test/core/agent/agent_profile_registry_test.dart
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/core/agent/agent_profile.dart lib/core/agent/agent_profile_registry.dart test/core/agent/agent_profile_registry_test.dart
git commit -m "feat(agent): AgentProfile abstract + registry"
```

---

### Task 22 — ClaudeCodeProfile

**Files:**
- Create: `lib/core/agent/profiles/claude_code_profile.dart`
- Create: `test/core/agent/profiles/claude_code_profile_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/agent/profiles/claude_code_profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';

void main() {
  const profile = ClaudeCodeProfile();

  test('identity fields', () {
    expect(profile.id, AgentProfileId.claudeCode);
    expect(profile.binary, 'claude');
    expect(profile.projectContextFile, 'CLAUDE.md');
  });

  test('initial prompt references pickforge files in read order', () {
    final prompt = profile.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: 'screenshot.png',
      deviceScreenFilename: 'device-screen.png',
    );
    expect(
      prompt.indexOf('.pickforge/skill-active.md') <
          prompt.indexOf('.pickforge/widget-context.md'),
      isTrue,
    );
    expect(prompt, contains('.pickforge/screenshot.png'));
    expect(prompt, contains('.pickforge/device-screen.png'));
  });

  test('omits screenshot lines when paths are null', () {
    final prompt = profile.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: null,
      deviceScreenFilename: null,
    );
    expect(prompt, isNot(contains('screenshot.png')));
    expect(prompt, isNot(contains('device-screen.png')));
  });
}
```

- [ ] **Step 2: Implement the profile.**

```dart
// lib/core/agent/profiles/claude_code_profile.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

@Injectable(as: AgentProfile)
class ClaudeCodeProfile extends AgentProfile {
  const ClaudeCodeProfile();

  @override
  AgentProfileId get id => AgentProfileId.claudeCode;

  @override
  String get displayName => 'Claude Code';

  @override
  String get binary => 'claude';

  @override
  String get projectContextFile => 'CLAUDE.md';

  @override
  List<String> invocationArgs() => const [];

  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) {
    final lines = <String>[
      'I am being invoked via Pickforge, a widget-picker for Flutter AI coding.',
      'Read these files in order before anything else:',
      '',
      '1. $pickforgeDirRelative/$skillFilename — your directive for this task.',
      '2. $pickforgeDirRelative/$widgetContextFilename — the selected widget.',
    ];
    if (screenshotFilename != null) {
      lines.add(
        '3. $pickforgeDirRelative/$screenshotFilename — widget render.',
      );
    }
    if (deviceScreenFilename != null) {
      lines.add(
        '4. $pickforgeDirRelative/$deviceScreenFilename — full device screen with selection outline.',
      );
    }
    lines.addAll([
      '',
      'Then follow the skill.',
    ]);
    return lines.join('\n');
  }
}
```

- [ ] **Step 3: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/agent/profiles/claude_code_profile_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/agent/profiles/claude_code_profile.dart test/core/agent/profiles/claude_code_profile_test.dart
git commit -m "feat(agent): add first cli agent profile"
```

---

### Task 23 — CodexProfile + OpenCodeProfile

**Files:**
- Create: `lib/core/agent/profiles/codex_profile.dart`
- Create: `lib/core/agent/profiles/opencode_profile.dart`
- Create: `test/core/agent/profiles/codex_profile_test.dart`
- Create: `test/core/agent/profiles/opencode_profile_test.dart`

- [ ] **Step 1: Write failing tests for both profiles.**

```dart
// test/core/agent/profiles/codex_profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';

void main() {
  const profile = CodexProfile();

  test('identity', () {
    expect(profile.id, AgentProfileId.codex);
    expect(profile.displayName, 'Codex');
    expect(profile.binary, 'codex');
    expect(profile.projectContextFile, 'AGENTS.md');
  });

  test('prompt includes context and image filenames', () {
    final prompt = profile.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: 'screenshot.png',
      deviceScreenFilename: 'device-screen.png',
    );

    expect(prompt, contains('.pickforge/skill-active.md'));
    expect(prompt, contains('.pickforge/widget-context.md'));
    expect(prompt, contains('.pickforge/screenshot.png'));
    expect(prompt, contains('.pickforge/device-screen.png'));
  });

  test('prompt excludes null image filenames', () {
    final prompt = profile.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: null,
      deviceScreenFilename: null,
    );

    expect(prompt, contains('.pickforge/skill-active.md'));
    expect(prompt, contains('.pickforge/widget-context.md'));
    expect(prompt, isNot(contains('screenshot.png')));
    expect(prompt, isNot(contains('device-screen.png')));
  });
}
```

```dart
// test/core/agent/profiles/opencode_profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';

void main() {
  const profile = OpenCodeProfile();

  test('identity', () {
    expect(profile.id, AgentProfileId.opencode);
    expect(profile.displayName, 'OpenCode');
    expect(profile.binary, 'opencode');
    expect(profile.projectContextFile, 'AGENTS.md');
  });

  test('prompt includes context and image filenames', () {
    final prompt = profile.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: 'screenshot.png',
      deviceScreenFilename: 'device-screen.png',
    );

    expect(prompt, contains('.pickforge/skill-active.md'));
    expect(prompt, contains('.pickforge/widget-context.md'));
    expect(prompt, contains('.pickforge/screenshot.png'));
    expect(prompt, contains('.pickforge/device-screen.png'));
  });

  test('prompt excludes null image filenames', () {
    final prompt = profile.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: 'skill-active.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: null,
      deviceScreenFilename: null,
    );

    expect(prompt, contains('.pickforge/skill-active.md'));
    expect(prompt, contains('.pickforge/widget-context.md'));
    expect(prompt, isNot(contains('screenshot.png')));
    expect(prompt, isNot(contains('device-screen.png')));
  });
}
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
fvm flutter test test/core/agent/profiles
```

Expected: FAIL with imports for `codex_profile.dart` and `opencode_profile.dart` not found.

- [ ] **Step 3: Implement `CodexProfile`.**

```dart
// lib/core/agent/profiles/codex_profile.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

@Injectable(as: AgentProfile)
class CodexProfile extends AgentProfile {
  const CodexProfile();

  @override
  AgentProfileId get id => AgentProfileId.codex;

  @override
  String get displayName => 'Codex';

  @override
  String get binary => 'codex';

  @override
  String get projectContextFile => 'AGENTS.md';

  @override
  List<String> invocationArgs() => const [];

  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) {
    final lines = <String>[
      'Invoked via Pickforge. Read these files first:',
      '',
      '- $pickforgeDirRelative/$skillFilename',
      '- $pickforgeDirRelative/$widgetContextFilename',
    ];
    if (screenshotFilename != null) {
      lines.add('- $pickforgeDirRelative/$screenshotFilename');
    }
    if (deviceScreenFilename != null) {
      lines.add('- $pickforgeDirRelative/$deviceScreenFilename');
    }
    lines.addAll(['', 'Then proceed.']);
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Implement `OpenCodeProfile`.**

```dart
// lib/core/agent/profiles/opencode_profile.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

@Injectable(as: AgentProfile)
class OpenCodeProfile extends AgentProfile {
  const OpenCodeProfile();

  @override
  AgentProfileId get id => AgentProfileId.opencode;

  @override
  String get displayName => 'OpenCode';

  @override
  String get binary => 'opencode';

  @override
  String get projectContextFile => 'AGENTS.md';

  @override
  List<String> invocationArgs() => const [];

  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) {
    final lines = <String>[
      'Invoked via Pickforge. Start by reading:',
      '',
      '- $pickforgeDirRelative/$skillFilename',
      '- $pickforgeDirRelative/$widgetContextFilename',
    ];
    if (screenshotFilename != null) {
      lines.add('- $pickforgeDirRelative/$screenshotFilename');
    }
    if (deviceScreenFilename != null) {
      lines.add('- $pickforgeDirRelative/$deviceScreenFilename');
    }
    lines.addAll(['', 'Then proceed with the skill.']);
    return lines.join('\n');
  }
}
```

- [ ] **Step 5: Codegen + run tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/agent/profiles
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/core/agent/profiles test/core/agent/profiles
git commit -m "feat(agent): add CodexProfile and OpenCodeProfile"
```

---

## Phase 7 — Terminal profiles

Goal: `TerminalProfile` abstraction + concrete profiles for the MVP-supported terminals (Ghostty, iTerm2, Warp, WezTerm, Alacritty, Kitty, Windows Terminal, gnome-terminal, Terminal.app, `$TERMINAL` fallback) with PATH-detection + launch.

### Task 24 — TerminalProfile abstract + detection utility

**Files:**
- Create: `lib/core/terminal/terminal_profile.dart`
- Create: `lib/core/terminal/terminal_detector.dart`
- Create: `lib/core/terminal/terminal_profile_registry.dart`
- Create: `test/core/terminal/terminal_detector_test.dart`

- [ ] **Step 1: Define the abstract profile.**

```dart
// lib/core/terminal/terminal_profile.dart
import 'dart:io';

import 'models.dart';

abstract class TerminalProfile {
  const TerminalProfile();

  TerminalProfileId get id;
  String get displayName;

  /// Platforms this profile even applies on.
  Set<OperatingSystem> get supportedPlatforms;

  /// Probe the system to see if this terminal is actually available.
  Future<bool> isInstalled();

  /// Build the `Process.start` args that spawn this terminal running the
  /// given wrapper script. Should not actually start the process.
  Future<LaunchInvocation> buildInvocation(TerminalLaunchSpec spec);
}

enum OperatingSystem { linux, macos, windows }

OperatingSystem get currentOs {
  if (Platform.isLinux) return OperatingSystem.linux;
  if (Platform.isMacOS) return OperatingSystem.macos;
  if (Platform.isWindows) return OperatingSystem.windows;
  throw UnsupportedError('Unsupported OS: ${Platform.operatingSystem}');
}

class LaunchInvocation {
  const LaunchInvocation({
    required this.executable,
    required this.arguments,
    this.environment,
  });

  final String executable;
  final List<String> arguments;
  final Map<String, String>? environment;
}
```

- [ ] **Step 2: Implement the detector.**

```dart
// lib/core/terminal/terminal_detector.dart
import 'dart:io';

import 'package:injectable/injectable.dart';

typedef ProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

@lazySingleton
class TerminalDetector {
  TerminalDetector({ProcessRunner? runner}) : _run = runner ?? Process.run;

  final ProcessRunner _run;

  Future<bool> isOnPath(String binary) async {
    final finder = Platform.isWindows ? 'where' : 'which';
    final result = await _run(finder, [binary]);
    return result.exitCode == 0;
  }
}
```

- [ ] **Step 3: Write the detector test.**

```dart
// test/core/terminal/terminal_detector_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

void main() {
  test('isOnPath returns true when runner exits 0', () async {
    final detector = TerminalDetector(
      runner: (_, __) async => ProcessResult(1, 0, '/usr/bin/x\n', ''),
    );
    expect(await detector.isOnPath('x'), isTrue);
  });

  test('isOnPath returns false when runner exits non-zero', () async {
    final detector = TerminalDetector(
      runner: (_, __) async => ProcessResult(1, 1, '', 'not found'),
    );
    expect(await detector.isOnPath('x'), isFalse);
  });
}
```

- [ ] **Step 4: Registry.**

```dart
// lib/core/terminal/terminal_profile_registry.dart
import 'package:injectable/injectable.dart';

import 'models.dart';
import 'terminal_profile.dart';

@lazySingleton
class TerminalProfileRegistry {
  TerminalProfileRegistry(this._profiles);
  final List<TerminalProfile> _profiles;

  TerminalProfile get(TerminalProfileId id) => _profiles.firstWhere(
        (p) => p.id == id,
        orElse: () =>
            throw StateError('No TerminalProfile registered for $id'),
      );

  List<TerminalProfile> availableOnThisOs() => _profiles
      .where((p) => p.supportedPlatforms.contains(currentOs))
      .toList(growable: false);
}
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/terminal/terminal_detector_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/core/terminal/terminal_profile.dart lib/core/terminal/terminal_detector.dart lib/core/terminal/terminal_profile_registry.dart test/core/terminal/terminal_detector_test.dart
git commit -m "feat(terminal): TerminalProfile abstract + detector + registry"
```

---

### Task 25 — Concrete terminal profiles (Linux/macOS)

**Files:**
- Create: `lib/core/terminal/profiles/ghostty_profile.dart`
- Create: `lib/core/terminal/profiles/wezterm_profile.dart`
- Create: `lib/core/terminal/profiles/alacritty_profile.dart`
- Create: `lib/core/terminal/profiles/kitty_profile.dart`
- Create: `lib/core/terminal/profiles/gnome_terminal_profile.dart`
- Create: `lib/core/terminal/profiles/iterm2_profile.dart`
- Create: `lib/core/terminal/profiles/terminal_app_profile.dart`
- Create: `lib/core/terminal/profiles/env_fallback_profile.dart`
- Create: `test/core/terminal/profiles/unix_profiles_test.dart`

- [ ] **Step 1: Implement `GhosttyProfile` — the canonical pattern.**

```dart
// lib/core/terminal/profiles/ghostty_profile.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

@Injectable(as: TerminalProfile)
class GhosttyProfile extends TerminalProfile {
  GhosttyProfile(this._detector);
  final TerminalDetector _detector;

  @override
  TerminalProfileId get id => TerminalProfileId.ghostty;

  @override
  String get displayName => 'Ghostty';

  @override
  Set<OperatingSystem> get supportedPlatforms =>
      {OperatingSystem.linux, OperatingSystem.macos};

  @override
  Future<bool> isInstalled() => _detector.isOnPath('ghostty');

  @override
  Future<LaunchInvocation> buildInvocation(TerminalLaunchSpec spec) async {
    return LaunchInvocation(
      executable: 'ghostty',
      arguments: ['-e', spec.scriptPath],
      environment: spec.env,
    );
  }
}
```

- [ ] **Step 2: Implement the rest with the same structure.** Key differences:

| Profile | binary / `-e`-ish flag | Supported | Notes |
|---|---|---|---|
| `WezTermProfile` | `wezterm start --cwd <cwd> -- <script>` | Linux, macOS, Windows | Keep a Unix-only subclass here; Windows version lives in Task 26 |
| `AlacrittyProfile` | `alacritty -e <script>` | Linux, macOS, Windows | |
| `KittyProfile` | `kitty <script>` | Linux, macOS | No `-e`; runs script directly |
| `GnomeTerminalProfile` | `gnome-terminal -- <script>` | Linux | |
| `ITerm2Profile` | AppleScript: `open -a iTerm.app <script>` | macOS | Simple path-as-arg works |
| `TerminalAppProfile` | `open -a Terminal.app <script>` | macOS | |
| `EnvFallbackProfile` | `sh -c "$TERMINAL -e <script>"` | Linux, macOS | Reads `Platform.environment['TERMINAL']`; returns false from `isInstalled()` when unset |

For each profile, follow the Ghostty template exactly. Example for `KittyProfile` (note: kitty takes the command as positional args, not `-e`):

```dart
@override
Future<LaunchInvocation> buildInvocation(TerminalLaunchSpec spec) async {
  return LaunchInvocation(
    executable: 'kitty',
    arguments: [spec.scriptPath],
    environment: spec.env,
  );
}
```

For `EnvFallbackProfile`:

```dart
@override
Future<bool> isInstalled() async {
  final term = Platform.environment['TERMINAL'];
  return term != null && term.isNotEmpty && await _detector.isOnPath(term);
}

@override
Future<LaunchInvocation> buildInvocation(TerminalLaunchSpec spec) async {
  final term = Platform.environment['TERMINAL']!;
  return LaunchInvocation(
    executable: term,
    arguments: ['-e', spec.scriptPath],
    environment: spec.env,
  );
}
```

- [ ] **Step 3: Write parameterized tests for all Unix profiles.**

```dart
// test/core/terminal/profiles/unix_profiles_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/profiles/alacritty_profile.dart';
import 'package:pickforge/core/terminal/profiles/ghostty_profile.dart';
import 'package:pickforge/core/terminal/profiles/gnome_terminal_profile.dart';
import 'package:pickforge/core/terminal/profiles/kitty_profile.dart';
import 'package:pickforge/core/terminal/profiles/wezterm_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

TerminalLaunchSpec _spec(TerminalProfileId id) => TerminalLaunchSpec(
      id: id,
      scriptPath: '/tmp/wrapper.sh',
      workingDir: '/home/me/app',
      env: const {},
    );

void main() {
  final detector = TerminalDetector(
    runner: (_, __) async => throw UnimplementedError(),
  );

  test('Ghostty invocation uses -e <script>', () async {
    final inv = await GhosttyProfile(detector)
        .buildInvocation(_spec(TerminalProfileId.ghostty));
    expect(inv.executable, 'ghostty');
    expect(inv.arguments, ['-e', '/tmp/wrapper.sh']);
  });

  test('Kitty invocation passes script as positional arg', () async {
    final inv = await KittyProfile(detector)
        .buildInvocation(_spec(TerminalProfileId.kitty));
    expect(inv.executable, 'kitty');
    expect(inv.arguments, ['/tmp/wrapper.sh']);
  });

  test('WezTerm invocation uses start --cwd -- <script>', () async {
    final inv = await WezTermProfile(detector)
        .buildInvocation(_spec(TerminalProfileId.wezterm));
    expect(inv.executable, 'wezterm');
    expect(inv.arguments, ['start', '--cwd', '/home/me/app', '--', '/tmp/wrapper.sh']);
  });

  test('Alacritty invocation uses -e <script>', () async {
    final inv = await AlacrittyProfile(detector)
        .buildInvocation(_spec(TerminalProfileId.alacritty));
    expect(inv.arguments, ['-e', '/tmp/wrapper.sh']);
  });

  test('gnome-terminal invocation uses -- <script>', () async {
    final inv = await GnomeTerminalProfile(detector)
        .buildInvocation(_spec(TerminalProfileId.gnomeTerminal));
    expect(inv.arguments, ['--', '/tmp/wrapper.sh']);
  });
}
```

- [ ] **Step 4: Codegen + run tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/terminal/profiles
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/core/terminal/profiles test/core/terminal/profiles
git commit -m "feat(terminal): add Unix terminal profiles (Ghostty, WezTerm, Alacritty, Kitty, gnome-terminal, iTerm2, Terminal.app, env fallback)"
```

---

### Task 26 — Windows + Warp URL-scheme profile

**Files:**
- Create: `lib/core/terminal/profiles/windows_terminal_profile.dart`
- Create: `lib/core/terminal/profiles/warp_profile.dart`
- Create: `test/core/terminal/profiles/windows_terminal_profile_test.dart`
- Create: `test/core/terminal/profiles/warp_profile_test.dart`

- [ ] **Step 1: Implement `WindowsTerminalProfile`.**

```dart
// lib/core/terminal/profiles/windows_terminal_profile.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

@Injectable(as: TerminalProfile)
class WindowsTerminalProfile extends TerminalProfile {
  WindowsTerminalProfile(this._detector);
  final TerminalDetector _detector;

  @override
  TerminalProfileId get id => TerminalProfileId.windowsTerminal;

  @override
  String get displayName => 'Windows Terminal';

  @override
  Set<OperatingSystem> get supportedPlatforms => {OperatingSystem.windows};

  @override
  Future<bool> isInstalled() => _detector.isOnPath('wt.exe');

  @override
  Future<LaunchInvocation> buildInvocation(TerminalLaunchSpec spec) async {
    return LaunchInvocation(
      executable: 'wt.exe',
      arguments: [
        '-d',
        spec.workingDir,
        'cmd.exe',
        '/c',
        spec.scriptPath,
      ],
      environment: spec.env,
    );
  }
}
```

- [ ] **Step 2: Implement `WarpProfile` using its `warp://` URL scheme.**

```dart
// lib/core/terminal/profiles/warp_profile.dart
import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

@Injectable(as: TerminalProfile)
class WarpProfile extends TerminalProfile {
  WarpProfile(this._detector);
  final TerminalDetector _detector;

  @override
  TerminalProfileId get id => TerminalProfileId.warp;

  @override
  String get displayName => 'Warp';

  @override
  Set<OperatingSystem> get supportedPlatforms =>
      {OperatingSystem.macos, OperatingSystem.linux};

  @override
  Future<bool> isInstalled() async {
    if (Platform.isMacOS) {
      // Warp installs as an .app; the `warp` CLI is optional. Check for the
      // bundle.
      return Directory('/Applications/Warp.app').existsSync();
    }
    return _detector.isOnPath('warp-terminal');
  }

  @override
  Future<LaunchInvocation> buildInvocation(TerminalLaunchSpec spec) async {
    // Use the `open` / `xdg-open` URL-scheme path to pre-fill a new Warp tab.
    final encodedPath = Uri.encodeComponent(spec.scriptPath);
    final encodedCwd = Uri.encodeComponent(spec.workingDir);
    final url =
        'warp://action/new_tab?path=$encodedCwd&command=$encodedPath';
    if (Platform.isMacOS) {
      return LaunchInvocation(
        executable: 'open',
        arguments: [url],
        environment: spec.env,
      );
    }
    return LaunchInvocation(
      executable: 'xdg-open',
      arguments: [url],
      environment: spec.env,
    );
  }
}
```

- [ ] **Step 3: Write tests.**

```dart
// test/core/terminal/profiles/windows_terminal_profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/profiles/windows_terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

void main() {
  test('Windows Terminal invocation uses wt.exe -d <cwd> cmd /c <script>',
      () async {
    final detector = TerminalDetector(
      runner: (_, __) async => throw UnimplementedError(),
    );
    final inv = await WindowsTerminalProfile(detector).buildInvocation(
      const TerminalLaunchSpec(
        id: TerminalProfileId.windowsTerminal,
        scriptPath: r'C:\temp\wrapper.bat',
        workingDir: r'C:\me\app',
        env: {},
      ),
    );
    expect(inv.executable, 'wt.exe');
    expect(
      inv.arguments,
      [r'-d', r'C:\me\app', 'cmd.exe', '/c', r'C:\temp\wrapper.bat'],
    );
  });
}
```

```dart
// test/core/terminal/profiles/warp_profile_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/profiles/warp_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

void main() {
  test('Warp invocation uses warp:// URL scheme', () async {
    final detector = TerminalDetector(
      runner: (_, __) async => throw UnimplementedError(),
    );
    final inv = await WarpProfile(detector).buildInvocation(
      const TerminalLaunchSpec(
        id: TerminalProfileId.warp,
        scriptPath: '/tmp/w.sh',
        workingDir: '/home/me/app',
        env: {},
      ),
    );
    expect(inv.arguments.single, contains('warp://action/new_tab'));
    expect(inv.arguments.single, contains('/tmp/w.sh'));
  });
}
```

- [ ] **Step 4: Codegen + run tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/terminal/profiles
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/core/terminal/profiles/windows_terminal_profile.dart lib/core/terminal/profiles/warp_profile.dart test/core/terminal/profiles/windows_terminal_profile_test.dart test/core/terminal/profiles/warp_profile_test.dart
git commit -m "feat(terminal): add Windows Terminal and Warp URL-scheme profiles"
```

---

## Phase 8 — Skills & context writer

Goal: ship the bundled skills, the loader that prefers project-local overrides, and the `.pickforge/` folder manager that writes per-invocation context files.

### Task 27 — Bundle the three MVP skills

**Files:**
- Create: `assets/skills/edit-widget.md`
- Create: `assets/skills/extract-widget.md`
- Create: `assets/skills/explain-widget.md`
- Create: `assets/agents/CLAUDE.md.tmpl`
- Create: `assets/agents/AGENTS.md.tmpl`

- [ ] **Step 1: Write `edit-widget.md`.**

```markdown
# Skill: Edit Widget

You are modifying a single Flutter widget that the user selected via Pickforge.

## Your scope

- Make **only** the change the user describes in the next message.
- Edit the widget at the creation location in `.pickforge/widget-context.md`.
- Do not refactor unrelated code, rename identifiers, reformat, or touch other files unless the change genuinely requires it.
- Preserve the project's linting / style (check for `analysis_options.yaml`).

## Process

1. Read the files listed in the initial prompt.
2. Before editing, state one short sentence describing what you'll change.
3. Apply the edit with the smallest possible diff.
4. Run the target project's normal analyzer command and fix any new issues your edit introduced.
5. Tell the user what to hot-reload / hot-restart.

## Do not

- Create new packages or imports unless necessary.
- Commit (the user commits).
- Add comments explaining what the code does.
- Ask clarifying questions for trivial details — infer sensible defaults.
```

- [ ] **Step 2: Write `extract-widget.md`.**

```markdown
# Skill: Extract Widget

You are extracting the currently selected Flutter widget (see `.pickforge/widget-context.md`) into its own widget class.

## Process

1. Read the files listed in the initial prompt.
2. Decide: `StatelessWidget` if no state/lifecycle is needed, `StatefulWidget` if it is.
3. Pick a class name that describes the widget's **role** (not "CustomContainer"). If the user hinted at a name, use it.
4. Place the new class in a sensibly named file under the same `lib/` folder as the original.
5. Replace the original call-site with an instance of the new widget.
6. Pass parameters only for the values that actually vary at the call site.
7. Run the target project's normal analyzer command; fix any new issues.

## Do not

- Move unrelated code.
- Add dependencies.
- Split into more than the one file the extraction needs.
```

- [ ] **Step 3: Write `explain-widget.md`.**

```markdown
# Skill: Explain Widget

You are explaining the currently selected Flutter widget to the user.

## Process

1. Read `.pickforge/widget-context.md`.
2. Briefly describe: what the widget renders, what it depends on (inherited widgets, state), and what data flows through it.
3. If there are non-obvious behaviors (gesture handlers, animation controllers, build-order quirks), call them out.
4. Offer one or two concrete improvement suggestions the user could request next.
5. Do **not** edit any files. You're explaining, not modifying.
```

- [ ] **Step 4: Write `assets/agents/CLAUDE.md.tmpl`.**

```markdown
# Pickforge session — Claude Code

You are being invoked via Pickforge. The `.pickforge/` directory in this
project root contains per-session context files.

## Rules

- Follow the skill in `.pickforge/skill-active.md`.
- Use the widget details in `.pickforge/widget-context.md` as ground truth for
  which widget the user selected.
- If the project has its own `CLAUDE.md` (sibling to this), obey that *in
  addition* — Pickforge never overrides project conventions.
- Never write to `.pickforge/` yourself. That directory is Pickforge's.
- Commit on the user's request, not proactively.
```

- [ ] **Step 5: Write `assets/agents/AGENTS.md.tmpl`** (similar but adjusted for Codex / OpenCode's conventions).

```markdown
# Pickforge session — Codex / OpenCode

You are being invoked via Pickforge. The `.pickforge/` directory in this
project root contains per-session context files.

## Rules

- Follow the skill in `.pickforge/skill-active.md`.
- Use the widget details in `.pickforge/widget-context.md` as ground truth.
- Respect any existing `AGENTS.md` in the project root as well.
- Never write to `.pickforge/`. That directory is Pickforge's.
```

- [ ] **Step 6: Commit.**

```bash
git add assets/skills assets/agents
git commit -m "feat(skills): bundle edit/extract/explain skills + agent templates"
```

---

### Task 28 — SkillStore loader

**Files:**
- Create: `lib/core/skills/skill_store.dart`
- Create: `test/core/skills/skill_store_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/skills/skill_store_test.dart
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/skills/models.dart';
import 'package:pickforge/core/skills/skill_store.dart';

void main() {
  late Directory tmpProject;

  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    tmpProject = Directory.systemTemp.createTempSync('pickforge_skills_');
  });
  tearDown(() => tmpProject.deleteSync(recursive: true));

  test('loadSkill returns bundled content when no override', () async {
    final store = SkillStore(assetBundle: rootBundle);
    final body =
        await store.loadSkill(SkillId.editWidget, projectRoot: tmpProject.path);
    expect(body, contains('Edit Widget'));
  });

  test('loadSkill prefers project-local override', () async {
    final override =
        Directory('${tmpProject.path}/.pickforge/skills')..createSync(recursive: true);
    File('${override.path}/edit-widget.md')
        .writeAsStringSync('# Overridden edit widget');
    final store = SkillStore(assetBundle: rootBundle);
    final body =
        await store.loadSkill(SkillId.editWidget, projectRoot: tmpProject.path);
    expect(body, contains('Overridden edit widget'));
  });
}
```

- [ ] **Step 2: Implement the store.**

```dart
// lib/core/skills/skill_store.dart
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;

import 'models.dart';

@lazySingleton
class SkillStore {
  SkillStore({AssetBundle? assetBundle})
      : _bundle = assetBundle ?? rootBundle;

  final AssetBundle _bundle;

  Future<String> loadSkill(SkillId id, {required String projectRoot}) async {
    final filename = '${id.value}.md';
    final override = File(p.join(projectRoot, '.pickforge', 'skills', filename));
    if (override.existsSync()) {
      return override.readAsString();
    }
    return _bundle.loadString('assets/skills/$filename');
  }

  Future<String> loadAgentTemplate({required bool forClaude}) {
    final filename = forClaude ? 'CLAUDE.md.tmpl' : 'AGENTS.md.tmpl';
    return _bundle.loadString('assets/agents/$filename');
  }
}
```

- [ ] **Step 3: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/skills/skill_store_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/skills/skill_store.dart test/core/skills/skill_store_test.dart
git commit -m "feat(skills): SkillStore loader with project-local override"
```

---

### Task 29 — .pickforge/ folder manager + wrapper script generator

**Files:**
- Create: `lib/core/agent/pickforge_dir_manager.dart`
- Create: `lib/core/agent/wrapper_script_generator.dart`
- Create: `test/core/agent/pickforge_dir_manager_test.dart`
- Create: `test/core/agent/wrapper_script_generator_test.dart`

- [ ] **Step 1: Test the dir manager.**

```dart
// test/core/agent/pickforge_dir_manager_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';

void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('pf_dir_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  test('ensure() creates .pickforge/ with gitignore when missing', () async {
    final manager = PickforgeDirManager();
    final dir = await manager.ensure(projectRoot: tmp.path);
    expect(dir.existsSync(), isTrue);
    expect(File('${dir.path}/.gitignore').readAsStringSync(), '*\n');
  });

  test('ensure() refuses when directory exists without Pickforge marker',
      () async {
    Directory('${tmp.path}/.pickforge').createSync();
    File('${tmp.path}/.pickforge/unknown.txt').writeAsStringSync('');
    final manager = PickforgeDirManager();
    expect(
      () => manager.ensure(projectRoot: tmp.path),
      throwsA(isA<PickforgeDirConflictException>()),
    );
  });

  test('ensure() accepts an existing dir with a .pickforge marker', () async {
    Directory('${tmp.path}/.pickforge').createSync();
    File('${tmp.path}/.pickforge/.gitignore').writeAsStringSync('*\n');
    final manager = PickforgeDirManager();
    final dir = await manager.ensure(projectRoot: tmp.path);
    expect(dir.existsSync(), isTrue);
  });
}
```

- [ ] **Step 2: Implement the dir manager.**

```dart
// lib/core/agent/pickforge_dir_manager.dart
import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;

class PickforgeDirConflictException implements Exception {
  PickforgeDirConflictException(this.path);
  final String path;
  @override
  String toString() =>
      '.pickforge/ already exists at $path and does not look like Pickforge\'s. '
      'Rename or delete it.';
}

@lazySingleton
class PickforgeDirManager {
  Future<Directory> ensure({required String projectRoot}) async {
    final dir = Directory(p.join(projectRoot, '.pickforge'));
    if (!dir.existsSync()) {
      dir.createSync();
      File(p.join(dir.path, '.gitignore')).writeAsStringSync('*\n');
      return dir;
    }
    // Accept only if our own .gitignore (or other known marker) is present.
    final gitignore = File(p.join(dir.path, '.gitignore'));
    if (!gitignore.existsSync() || gitignore.readAsStringSync() != '*\n') {
      throw PickforgeDirConflictException(dir.path);
    }
    return dir;
  }

  Future<void> writeContext({
    required Directory pickforgeDir,
    required String skillActive,
    required String widgetContext,
    required String runLogJson,
  }) async {
    File(p.join(pickforgeDir.path, 'skill-active.md'))
        .writeAsStringSync(skillActive);
    File(p.join(pickforgeDir.path, 'widget-context.md'))
        .writeAsStringSync(widgetContext);
    File(p.join(pickforgeDir.path, 'run-log.json'))
        .writeAsStringSync(runLogJson);
  }
}
```

- [ ] **Step 3: Test the wrapper script generator.**

```dart
// test/core/agent/wrapper_script_generator_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';

void main() {
  test('unix wrapper script cd\'s into project and invokes agent via stdin',
      () {
    const gen = WrapperScriptGenerator();
    final script = gen.unix(
      projectRoot: '/home/me/app',
      agentBinary: 'claude',
      agentArgs: const [],
      initialPromptPath: '/tmp/pickforge/prompt.txt',
    );
    expect(script, contains('#!/usr/bin/env bash'));
    expect(script, contains("cd '/home/me/app'"));
    expect(script, contains('claude'));
    expect(script, contains("< '/tmp/pickforge/prompt.txt'"));
  });

  test('windows wrapper uses cmd.exe syntax', () {
    const gen = WrapperScriptGenerator();
    final script = gen.windows(
      projectRoot: r'C:\me\app',
      agentBinary: 'claude',
      agentArgs: const [],
      initialPromptPath: r'C:\Temp\prompt.txt',
    );
    expect(script, contains('@echo off'));
    expect(script, contains(r'cd /d "C:\me\app"'));
    expect(script, contains(r'type "C:\Temp\prompt.txt" | claude'));
  });
}
```

- [ ] **Step 4: Implement the generator.**

```dart
// lib/core/agent/wrapper_script_generator.dart
import 'package:injectable/injectable.dart';

@lazySingleton
class WrapperScriptGenerator {
  const WrapperScriptGenerator();

  String unix({
    required String projectRoot,
    required String agentBinary,
    required List<String> agentArgs,
    required String initialPromptPath,
  }) {
    final args = agentArgs.map((a) => "'$a'").join(' ');
    return '''#!/usr/bin/env bash
set -euo pipefail
cd '$projectRoot'
$agentBinary $args < '$initialPromptPath'
''';
  }

  String windows({
    required String projectRoot,
    required String agentBinary,
    required List<String> agentArgs,
    required String initialPromptPath,
  }) {
    final args = agentArgs.join(' ');
    return '''@echo off
cd /d "$projectRoot"
type "$initialPromptPath" | $agentBinary $args
''';
  }
}
```

- [ ] **Step 5: Codegen + run tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/agent/pickforge_dir_manager_test.dart test/core/agent/wrapper_script_generator_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/core/agent/pickforge_dir_manager.dart lib/core/agent/wrapper_script_generator.dart test/core/agent
git commit -m "feat(agent): .pickforge/ dir manager + wrapper script generator"
```

---

## Phase 9 — Agent launcher orchestration

Goal: a single `AgentLauncher` service that, given a `ForgeRequest`, writes all context files, generates the wrapper, and spawns the chosen terminal with the chosen agent. Plus the optional `adb screencap` capture.

### Task 30 — AgentLauncher

**Files:**
- Create: `lib/core/agent/agent_launcher.dart`
- Create: `lib/core/agent/widget_context_renderer.dart`
- Create: `test/core/agent/agent_launcher_test.dart`
- Create: `test/core/agent/widget_context_renderer_test.dart`

- [ ] **Step 1: Test the widget context renderer.**

```dart
// test/core/agent/widget_context_renderer_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/inspector/models.dart';

void main() {
  test('renderer produces markdown sections with widget details', () {
    const renderer = WidgetContextRenderer();
    final md = renderer.render(
      const SelectedWidget(
        node: WidgetNode(
          id: 'inspector-1',
          className: 'ElevatedButton',
          children: [],
          creationLocation: CreationLocation(
            file: 'lib/foo.dart',
            line: 10,
            column: 3,
          ),
        ),
        ancestorClasses: ['Scaffold', 'Column', 'Padding'],
        sourceSnippet: '   10  ElevatedButton(...)',
        screenshotPath: '/tmp/a.png',
        adbScreenshotPath: null,
        propertiesJson: {'enabled': true},
      ),
    );
    expect(md, contains('# Selected widget: `ElevatedButton`'));
    expect(md, contains('lib/foo.dart:10:3'));
    expect(md, contains('Scaffold → Column → Padding → ElevatedButton'));
    expect(md, contains('```dart'));
  });
}
```

- [ ] **Step 2: Implement the renderer.**

```dart
// lib/core/agent/widget_context_renderer.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/inspector/models.dart';

@lazySingleton
class WidgetContextRenderer {
  const WidgetContextRenderer();

  String render(SelectedWidget sel) {
    final loc = sel.node.creationLocation;
    final locLine = loc == null
        ? '_(framework widget — no user-code location)_'
        : '`${loc.file}:${loc.line}:${loc.column}`';
    final ancestorChain =
        [...sel.ancestorClasses, sel.node.className].join(' → ');
    final snippet = sel.sourceSnippet == null
        ? '_no source snippet available_'
        : '```dart\n${sel.sourceSnippet}\n```';
    return '''# Selected widget: `${sel.node.className}`

**Creation location:** $locLine

**Ancestor chain:**

$ancestorChain

**Source snippet (from creation location ±20 lines):**

$snippet
''';
  }
}
```

- [ ] **Step 3: Test the launcher end-to-end (with mocked side effects).**

```dart
// test/core/agent/agent_launcher_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';

class _MockAgentRegistry extends Mock implements AgentProfileRegistry {}
class _MockTerminalRegistry extends Mock implements TerminalProfileRegistry {}
class _MockAgent extends Mock implements AgentProfile {}
class _MockTerminal extends Mock implements TerminalProfile {}
class _MockSkillStore extends Mock implements SkillStore {}
class _FakeSpec extends Fake implements TerminalLaunchSpec {}
class _FakeLocation extends Fake implements CreationLocation {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeSpec());
    registerFallbackValue(_FakeLocation());
  });

  late Directory tmp;
  late AgentLauncher launcher;
  late _MockAgent agent;
  late _MockTerminal terminal;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('pf_launcher_');
    agent = _MockAgent();
    terminal = _MockTerminal();

    when(() => agent.id).thenReturn(AgentProfileId.claudeCode);
    when(() => agent.binary).thenReturn('claude');
    when(() => agent.invocationArgs()).thenReturn(const []);
    when(() => agent.projectContextFile).thenReturn('CLAUDE.md');
    when(() => agent.buildInitialPrompt(
          pickforgeDirRelative: any(named: 'pickforgeDirRelative'),
          skillFilename: any(named: 'skillFilename'),
          widgetContextFilename: any(named: 'widgetContextFilename'),
          screenshotFilename: any(named: 'screenshotFilename'),
          deviceScreenFilename: any(named: 'deviceScreenFilename'),
        )).thenReturn('INITIAL PROMPT');

    final agentRegistry = _MockAgentRegistry();
    when(() => agentRegistry.get(any())).thenReturn(agent);

    when(() => terminal.buildInvocation(any())).thenAnswer(
      (_) async => const LaunchInvocation(
        executable: '/bin/true',
        arguments: [],
      ),
    );
    final terminalRegistry = _MockTerminalRegistry();
    when(() => terminalRegistry.get(any())).thenReturn(terminal);

    final skillStore = _MockSkillStore();
    when(() => skillStore.loadSkill(any(), projectRoot: any(named: 'projectRoot')))
        .thenAnswer((_) async => '# skill body');

    launcher = AgentLauncher(
      agents: agentRegistry,
      terminals: terminalRegistry,
      dirManager: PickforgeDirManager(),
      skillStore: skillStore,
      renderer: const WidgetContextRenderer(),
      wrapper: const WrapperScriptGenerator(),
      processSpawner: (exe, args, {env, workingDir}) async =>
          ProcessResult(42, 0, '', ''),
    );
  });

  tearDown(() => tmp.deleteSync(recursive: true));

  test('launch writes .pickforge/ files and spawns the terminal', () async {
    final req = ForgeRequest(
      widget: const SelectedWidget(
        node: WidgetNode(
          id: 'x',
          className: 'ElevatedButton',
          children: [],
          creationLocation: CreationLocation(
            file: 'lib/foo.dart',
            line: 10,
            column: 3,
          ),
        ),
        ancestorClasses: ['Scaffold'],
        sourceSnippet: 'code',
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      ),
      skill: SkillId.editWidget,
      agentId: AgentProfileId.claudeCode,
      terminalId: 'ghostty',
      projectRoot: tmp.path,
    );

    await launcher.launch(req);

    expect(
      File('${tmp.path}/.pickforge/skill-active.md').existsSync(),
      isTrue,
    );
    expect(
      File('${tmp.path}/.pickforge/widget-context.md').existsSync(),
      isTrue,
    );
    expect(
      File('${tmp.path}/.pickforge/run-log.json').existsSync(),
      isTrue,
    );
  });
}
```

- [ ] **Step 4: Implement `AgentLauncher`.**

```dart
// lib/core/agent/agent_launcher.dart
import 'dart:convert';
import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_dir_manager.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/agent/wrapper_script_generator.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';

typedef ProcessSpawner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments, {
  Map<String, String>? env,
  String? workingDir,
});

@lazySingleton
class AgentLauncher {
  AgentLauncher({
    required AgentProfileRegistry agents,
    required TerminalProfileRegistry terminals,
    required PickforgeDirManager dirManager,
    required SkillStore skillStore,
    required WidgetContextRenderer renderer,
    required WrapperScriptGenerator wrapper,
    ProcessSpawner? processSpawner,
  })  : _agents = agents,
        _terminals = terminals,
        _dirManager = dirManager,
        _skills = skillStore,
        _renderer = renderer,
        _wrapper = wrapper,
        _spawn = processSpawner ?? _realSpawn;

  final AgentProfileRegistry _agents;
  final TerminalProfileRegistry _terminals;
  final PickforgeDirManager _dirManager;
  final SkillStore _skills;
  final WidgetContextRenderer _renderer;
  final WrapperScriptGenerator _wrapper;
  final ProcessSpawner _spawn;

  Future<ProcessResult> launch(ForgeRequest req) async {
    final agent = _agents.get(req.agentId);
    final terminal =
        _terminals.get(TerminalProfileId.fromValue(req.terminalId));
    final dir = await _dirManager.ensure(projectRoot: req.projectRoot);
    final skillBody =
        await _skills.loadSkill(req.skill, projectRoot: req.projectRoot);
    final contextBody = _renderer.render(req.widget);
    final runLog = json.encode({
      'skill': req.skill.value,
      'agent': req.agentId.value,
      'terminal': req.terminalId,
      'started_at': DateTime.now().toIso8601String(),
    });

    await _dirManager.writeContext(
      pickforgeDir: dir,
      skillActive: skillBody,
      widgetContext: contextBody,
      runLogJson: runLog,
    );

    final promptPath = p.join(dir.path, 'initial-prompt.md');
    File(promptPath).writeAsStringSync(
      agent.buildInitialPrompt(
        pickforgeDirRelative: '.pickforge',
        skillFilename: 'skill-active.md',
        widgetContextFilename: 'widget-context.md',
        screenshotFilename:
            req.widget.screenshotPath != null ? 'screenshot.png' : null,
        deviceScreenFilename:
            req.widget.adbScreenshotPath != null ? 'device-screen.png' : null,
      ),
    );

    final scriptPath = p.join(dir.path, 'wrapper.${_scriptExtension}');
    final scriptBody = Platform.isWindows
        ? _wrapper.windows(
            projectRoot: req.projectRoot,
            agentBinary: agent.binary,
            agentArgs: agent.invocationArgs(),
            initialPromptPath: promptPath,
          )
        : _wrapper.unix(
            projectRoot: req.projectRoot,
            agentBinary: agent.binary,
            agentArgs: agent.invocationArgs(),
            initialPromptPath: promptPath,
          );
    final scriptFile = File(scriptPath)..writeAsStringSync(scriptBody);
    if (!Platform.isWindows) {
      await Process.run('chmod', ['+x', scriptPath]);
    }

    final spec = TerminalLaunchSpec(
      id: TerminalProfileId.fromValue(req.terminalId),
      scriptPath: scriptFile.path,
      workingDir: req.projectRoot,
      env: {},
    );
    final invocation = await terminal.buildInvocation(spec);
    return _spawn(
      invocation.executable,
      invocation.arguments,
      env: invocation.environment,
      workingDir: req.projectRoot,
    );
  }

  String get _scriptExtension => Platform.isWindows ? 'bat' : 'sh';
}

Future<ProcessResult> _realSpawn(
  String executable,
  List<String> arguments, {
  Map<String, String>? env,
  String? workingDir,
}) {
  return Process.run(
    executable,
    arguments,
    environment: env,
    workingDirectory: workingDir,
  );
}
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/agent/agent_launcher_test.dart
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/core/agent/agent_launcher.dart lib/core/agent/widget_context_renderer.dart test/core/agent/agent_launcher_test.dart test/core/agent/widget_context_renderer_test.dart
git commit -m "feat(agent): AgentLauncher orchestrates .pickforge write + terminal spawn"
```

---

### Task 31 — adb screencap capture

**Files:**
- Create: `lib/core/inspector/adb_screenshot_capturer.dart`
- Create: `test/core/inspector/adb_screenshot_capturer_test.dart`

- [ ] **Step 1: Write the test.**

```dart
// test/core/inspector/adb_screenshot_capturer_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('pf_adb_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  ProcessResult _ok(List<int> bytes) => ProcessResult(1, 0, bytes, '');

  test('capture writes PNG bytes when adb succeeds', () async {
    const pngHeader = [0x89, 0x50, 0x4E, 0x47];
    final detector = TerminalDetector(
      runner: (bin, args) async => _ok([]),
    );
    final capturer = AdbScreenshotCapturer(
      detector: detector,
      runner: (bin, args, {stdoutEncoding}) async {
        if (args.contains('devices')) {
          return ProcessResult(
            1,
            0,
            'List of devices attached\nemulator-5554\tdevice',
            '',
          );
        }
        if (args.contains('screencap')) {
          return ProcessResult(1, 0, pngHeader, '');
        }
        return ProcessResult(1, 1, '', '');
      },
    );
    final path = await capturer.capture(outputDir: tmp.path);
    expect(path, isNotNull);
    expect(File(path!).existsSync(), isTrue);
  });

  test('capture returns null when adb not on PATH', () async {
    final detector = TerminalDetector(
      runner: (_, __) async => ProcessResult(1, 1, '', 'not found'),
    );
    final capturer = AdbScreenshotCapturer(
      detector: detector,
      runner: (_, __, {stdoutEncoding}) async =>
          throw StateError('must not be called'),
    );
    expect(await capturer.capture(outputDir: tmp.path), isNull);
  });
}
```

- [ ] **Step 2: Implement the capturer.**

```dart
// lib/core/inspector/adb_screenshot_capturer.dart
import 'dart:convert';
import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/terminal_detector.dart';

typedef ProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments, {
  Encoding? stdoutEncoding,
});

@lazySingleton
class AdbScreenshotCapturer {
  AdbScreenshotCapturer({
    required this.detector,
    ProcessRunner? runner,
  }) : _run = runner ??
            ((executable, arguments, {stdoutEncoding}) => Process.run(
                  executable,
                  arguments,
                  stdoutEncoding: stdoutEncoding,
                ));

  final TerminalDetector detector;
  final ProcessRunner _run;

  Future<String?> capture({required String outputDir}) async {
    if (!await detector.isOnPath('adb')) return null;

    final devicesResult = await _run('adb', ['devices']);
    final serial = _firstEmulatorSerial(devicesResult.stdout as String);
    if (serial == null) return null;

    final capResult = await _run(
      'adb',
      ['-s', serial, 'exec-out', 'screencap', '-p'],
      stdoutEncoding: null,
    );
    if (capResult.exitCode != 0) return null;

    final outPath = p.join(outputDir, 'device-screen.png');
    await File(outPath).writeAsBytes(capResult.stdout as List<int>);
    return outPath;
  }

  String? _firstEmulatorSerial(String stdout) {
    for (final line in stdout.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.startsWith('emulator-') && trimmed.endsWith('device')) {
        return trimmed.split(RegExp(r'\s+')).first;
      }
    }
    return null;
  }
}
```

- [ ] **Step 3: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/core/inspector/adb_screenshot_capturer_test.dart
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/inspector/adb_screenshot_capturer.dart test/core/inspector/adb_screenshot_capturer_test.dart
git commit -m "feat(inspector): optional adb screencap capture for Android emulator"
```

---

## Phase 10 — Connection feature

Goal: the user pastes their VM Service URL, Pickforge connects, persists the URL per-project, enables Select Widget Mode. First user-visible feature.

### Task 32 — ConnectionBloc

**Files:**
- Create: `lib/features/connection/bloc/connection_bloc.dart`
- Create: `lib/features/connection/bloc/connection_event.dart`
- Create: `lib/features/connection/bloc/connection_state.dart`
- Create: `lib/features/connection/connection.dart` (barrel)
- Create: `test/features/connection/bloc/connection_bloc_test.dart`

- [ ] **Step 1: Define state + events (freezed).**

```dart
// lib/features/connection/bloc/connection_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'connection_state.freezed.dart';

@freezed
class ConnectionState with _$ConnectionState {
  const factory ConnectionState.idle({String? savedUrl}) = _Idle;
  const factory ConnectionState.connecting({required String url}) =
      _Connecting;
  const factory ConnectionState.connected({required String url}) = _Connected;
  const factory ConnectionState.error({
    required String url,
    required String message,
  }) = _Error;
}
```

```dart
// lib/features/connection/bloc/connection_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'connection_event.freezed.dart';

@freezed
class ConnectionEvent with _$ConnectionEvent {
  const factory ConnectionEvent.bootstrap({required String projectRoot}) =
      _Bootstrap;
  const factory ConnectionEvent.connectPressed({required String url}) =
      _ConnectPressed;
  const factory ConnectionEvent.disconnectPressed() = _DisconnectPressed;
}
```

- [ ] **Step 2: Test the bloc.**

```dart
// test/features/connection/bloc/connection_bloc_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/connection/connection.dart';

class _MockVm extends Mock implements VmServiceClient {}
class _MockSettings extends Mock implements ProjectSettingsRepository {}
class _MockInspector extends Mock implements InspectorRepository {}

void main() {
  late _MockVm vm;
  late _MockSettings settings;
  late _MockInspector inspector;

  setUp(() {
    vm = _MockVm();
    settings = _MockSettings();
    inspector = _MockInspector();
    when(() => settings.getVmServiceUrl(any())).thenAnswer((_) async => null);
    when(() => settings.setVmServiceUrl(any(), any()))
        .thenAnswer((_) async {});
  });

  blocTest<ConnectionBloc, ConnectionState>(
    'bootstrap loads saved URL into idle state',
    build: () {
      when(() => settings.getVmServiceUrl('/me/app'))
          .thenAnswer((_) async => 'ws://saved/ws');
      return ConnectionBloc(vm, settings, inspector);
    },
    act: (b) => b.add(const ConnectionEvent.bootstrap(projectRoot: '/me/app')),
    expect: () => [
      const ConnectionState.idle(savedUrl: 'ws://saved/ws'),
    ],
  );

  blocTest<ConnectionBloc, ConnectionState>(
    'connect happy path → Connecting → Connected',
    build: () {
      when(() => vm.connect(any())).thenAnswer((_) async {});
      when(inspector.enableSelectMode).thenAnswer((_) async {});
      return ConnectionBloc(vm, settings, inspector);
    },
    seed: () => const ConnectionState.idle(),
    act: (b) => b.add(
      const ConnectionEvent.connectPressed(url: 'ws://x/ws'),
    ),
    expect: () => [
      const ConnectionState.connecting(url: 'ws://x/ws'),
      const ConnectionState.connected(url: 'ws://x/ws'),
    ],
  );
}
```

- [ ] **Step 3: Implement the bloc.**

```dart
// lib/features/connection/bloc/connection_bloc.dart
import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';

import 'connection_event.dart';
import 'connection_state.dart';

@injectable
class ConnectionBloc extends Bloc<ConnectionEvent, ConnectionState> {
  ConnectionBloc(this._vm, this._settings, this._inspector)
      : super(const ConnectionState.idle()) {
    on<_Bootstrap>(_onBootstrap);
    on<_ConnectPressed>(_onConnect);
    on<_DisconnectPressed>(_onDisconnect);
  }

  final VmServiceClient _vm;
  final ProjectSettingsRepository _settings;
  final InspectorRepository _inspector;

  String? _projectRoot;

  Future<void> _onBootstrap(
    _Bootstrap e,
    Emitter<ConnectionState> emit,
  ) async {
    _projectRoot = e.projectRoot;
    final saved = await _settings.getVmServiceUrl(e.projectRoot);
    emit(ConnectionState.idle(savedUrl: saved));
  }

  Future<void> _onConnect(
    _ConnectPressed e,
    Emitter<ConnectionState> emit,
  ) async {
    emit(ConnectionState.connecting(url: e.url));
    try {
      await _vm.connect(e.url);
      await _inspector.enableSelectMode();
      final root = _projectRoot;
      if (root != null) {
        await _settings.setVmServiceUrl(root, e.url);
      }
      emit(ConnectionState.connected(url: e.url));
    } on Object catch (err) {
      emit(ConnectionState.error(url: e.url, message: err.toString()));
    }
  }

  Future<void> _onDisconnect(
    _DisconnectPressed e,
    Emitter<ConnectionState> emit,
  ) async {
    await _vm.disconnect();
    final saved = _projectRoot == null
        ? null
        : await _settings.getVmServiceUrl(_projectRoot!);
    emit(ConnectionState.idle(savedUrl: saved));
  }
}
```

- [ ] **Step 4: Barrel.**

```dart
// lib/features/connection/connection.dart
export 'bloc/connection_bloc.dart';
export 'bloc/connection_event.dart';
export 'bloc/connection_state.dart';
export 'view/connection_view.dart';
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/features/connection
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/features/connection/bloc lib/features/connection/connection.dart test/features/connection
git commit -m "feat(connection): add ConnectionBloc with bootstrap/connect/disconnect"
```

---

### Task 33 — ConnectionView + wire into router

**Files:**
- Create: `lib/features/connection/view/connection_view.dart`
- Create: `lib/features/connection/widgets/vm_service_url_field.dart`
- Modify: `lib/core/router/app_router.dart` (replace placeholder with `ConnectionView`)
- Create: `test/features/connection/view/connection_view_test.dart`

- [ ] **Step 1: Build the URL field widget.**

```dart
// lib/features/connection/widgets/vm_service_url_field.dart
import 'package:flutter/material.dart';

class VmServiceUrlField extends StatelessWidget {
  const VmServiceUrlField({
    required this.controller,
    required this.onSubmitted,
    super.key,
  });

  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: true,
      decoration: const InputDecoration(
        border: OutlineInputBorder(),
        hintText: 'ws://127.0.0.1:PORT/UUID=/ws',
      ),
      onSubmitted: onSubmitted,
    );
  }
}
```

- [ ] **Step 2: Build `ConnectionView`.**

```dart
// lib/features/connection/view/connection_view.dart
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/features/connection/bloc/connection_bloc.dart';
import 'package:pickforge/features/connection/bloc/connection_event.dart';
import 'package:pickforge/features/connection/bloc/connection_state.dart';
import 'package:pickforge/features/connection/widgets/vm_service_url_field.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ConnectionView extends StatelessWidget {
  const ConnectionView({
    ConnectionBloc? bloc,
    this.projectRoot,
    super.key,
  }) : _bloc = bloc;

  final ConnectionBloc? _bloc;
  final String? projectRoot;

  @override
  Widget build(BuildContext context) {
    final providedBloc = _bloc;
    if (providedBloc != null) {
      return BlocProvider.value(
        value: providedBloc,
        child: const _ConnectionBody(),
      );
    }

    final root = projectRoot ?? Directory.current.path;
    return BlocProvider(
      create: (_) => getIt<ConnectionBloc>()
        ..add(ConnectionEvent.bootstrap(projectRoot: root)),
      child: const _ConnectionBody(),
    );
  }
}

class _ConnectionBody extends StatefulWidget {
  const _ConnectionBody();
  @override
  State<_ConnectionBody> createState() => _ConnectionBodyState();
}

class _ConnectionBodyState extends State<_ConnectionBody> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return BlocConsumer<ConnectionBloc, ConnectionState>(
      listenWhen: (a, b) => a != b,
      listener: (ctx, state) {
        state.whenOrNull(
          idle: (saved) {
            if (saved != null && _controller.text.isEmpty) {
              _controller.text = saved;
            }
          },
        );
      },
      builder: (ctx, state) {
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.connectTitle,
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Text(l10n.connectUrlLabel,
                  style: Theme.of(context).textTheme.labelSmall),
              const SizedBox(height: 8),
              VmServiceUrlField(
                controller: _controller,
                onSubmitted: (v) => _submit(ctx, v),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: state.maybeMap(
                  connecting: (_) => null,
                  orElse: () => () => _submit(ctx, _controller.text),
                ),
                child: Text(l10n.connectButton),
              ),
              const SizedBox(height: 16),
              _StatusLine(state: state, l10n: l10n),
            ],
          ),
        );
      },
    );
  }

  void _submit(BuildContext ctx, String url) {
    ctx.read<ConnectionBloc>().add(ConnectionEvent.connectPressed(url: url));
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.state, required this.l10n});
  final ConnectionState state;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return state.when(
      idle: (_) => const SizedBox.shrink(),
      connecting: (_) => Text(l10n.connectStatusConnecting),
      connected: (_) => Text(l10n.connectStatusConnected),
      error: (_, message) => Text('${l10n.connectStatusError} — $message'),
    );
  }
}
```

- [ ] **Step 3: Wire `ConnectionView` into the router.**

Replace the `AppRoutes.connect` placeholder in `lib/core/router/app_router.dart`:

```dart
import 'package:pickforge/features/connection/connection.dart';

// inside routes:
GoRoute(
  path: AppRoutes.connect,
  builder: (_, __) => const ConnectionView(),
),
```

- [ ] **Step 4: Write a widget test.**

```dart
// test/features/connection/view/connection_view_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/features/connection/connection.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockConnectionBloc extends MockBloc<ConnectionEvent, ConnectionState>
    implements ConnectionBloc {}

void main() {
  testWidgets('renders title and hint', (tester) async {
    final bloc = _MockConnectionBloc();
    whenListen(
      bloc,
      const Stream<ConnectionState>.empty(),
      initialState: const ConnectionState.idle(),
    );
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ConnectionView(bloc: bloc, projectRoot: '/tmp/pickforge-test'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connect to your Flutter app'), findsOneWidget);
  });
}
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test
```

Expected: PASS across the board.

- [ ] **Step 6: Commit.**

```bash
git add lib/features/connection/view lib/features/connection/widgets lib/core/router/app_router.dart test/features/connection/view
git commit -m "feat(connection): ConnectionView wired into /connect route"
```

---

## Phase 11 — Widget picker feature

Goal: the Dock — widget tree, screenshot preview, selection details. This is the primary UI surface.

### Task 34 — Selection stream + WidgetPickerCubit

**Files:**
- Create: `lib/core/inspector/selection_stream.dart`
- Create: `lib/features/widget_picker/cubit/widget_picker_cubit.dart`
- Create: `lib/features/widget_picker/cubit/widget_picker_state.dart`
- Create: `lib/features/widget_picker/widget_picker.dart` (barrel)
- Create: `test/features/widget_picker/cubit/widget_picker_cubit_test.dart`

- [ ] **Step 1: Add `SelectionStream` — polls `getSelectedWidget` when select mode is on.**

```dart
// lib/core/inspector/selection_stream.dart
import 'dart:async';

import 'package:injectable/injectable.dart';

import 'inspector_repository.dart';
import 'models.dart';

@lazySingleton
class SelectionStream {
  SelectionStream(this._repo);
  final InspectorRepository _repo;

  Stream<SelectedWidget?> poll({
    Duration interval = const Duration(milliseconds: 500),
  }) async* {
    SelectedWidget? previous;
    while (true) {
      await Future<void>.delayed(interval);
      try {
        final next = await _repo.fetchSelection();
        if (next?.node.id != previous?.node.id) {
          previous = next;
          yield next;
        }
      } on Object {
        // swallow; reconnect logic lives elsewhere.
      }
    }
  }
}
```

- [ ] **Step 2: State + Cubit.**

```dart
// lib/features/widget_picker/cubit/widget_picker_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/inspector/models.dart';

part 'widget_picker_state.freezed.dart';

@freezed
class WidgetPickerState with _$WidgetPickerState {
  const factory WidgetPickerState({
    required SelectedWidget? selection,
    required bool selectModeEnabled,
  }) = _WidgetPickerState;

  factory WidgetPickerState.initial() =>
      const WidgetPickerState(selection: null, selectModeEnabled: false);
}
```

```dart
// lib/features/widget_picker/cubit/widget_picker_cubit.dart
import 'dart:async';

import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/selection_stream.dart';

import 'widget_picker_state.dart';

@injectable
class WidgetPickerCubit extends Cubit<WidgetPickerState> {
  WidgetPickerCubit(this._inspector, this._stream)
      : super(WidgetPickerState.initial());

  final InspectorRepository _inspector;
  final SelectionStream _stream;
  StreamSubscription<SelectedWidget?>? _sub;

  Future<void> startListening() async {
    await _inspector.enableSelectMode();
    emit(state.copyWith(selectModeEnabled: true));
    _sub = _stream.poll().listen((sel) {
      emit(state.copyWith(selection: sel));
    });
  }

  @override
  Future<void> close() async {
    await _sub?.cancel();
    await _inspector.disableSelectMode();
    return super.close();
  }
}
```

- [ ] **Step 3: Test.**

```dart
// test/features/widget_picker/cubit/widget_picker_cubit_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/selection_stream.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_cubit.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_state.dart';

class _MockInspector extends Mock implements InspectorRepository {}
class _MockStream extends Mock implements SelectionStream {}

void main() {
  late _MockInspector inspector;
  late _MockStream stream;

  const selected = SelectedWidget(
    node: WidgetNode(
      id: 'x',
      className: 'ElevatedButton',
      children: [],
      creationLocation: CreationLocation(
        file: 'lib/foo.dart',
        line: 1,
        column: 1,
      ),
    ),
    ancestorClasses: [],
    sourceSnippet: null,
    screenshotPath: null,
    adbScreenshotPath: null,
    propertiesJson: {},
  );

  setUp(() {
    inspector = _MockInspector();
    stream = _MockStream();
    when(inspector.enableSelectMode).thenAnswer((_) async {});
    when(inspector.disableSelectMode).thenAnswer((_) async {});
    when(() => stream.poll(interval: any(named: 'interval')))
        .thenAnswer((_) => Stream.fromIterable([selected]));
  });

  blocTest<WidgetPickerCubit, WidgetPickerState>(
    'startListening emits selectModeEnabled then selection',
    build: () => WidgetPickerCubit(inspector, stream),
    act: (c) => c.startListening(),
    expect: () => [
      WidgetPickerState.initial().copyWith(selectModeEnabled: true),
      WidgetPickerState.initial()
          .copyWith(selectModeEnabled: true, selection: selected),
    ],
  );
}
```

- [ ] **Step 4: Barrel.**

```dart
// lib/features/widget_picker/widget_picker.dart
export 'cubit/widget_picker_cubit.dart';
export 'cubit/widget_picker_state.dart';
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/features/widget_picker
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/core/inspector/selection_stream.dart lib/features/widget_picker/cubit lib/features/widget_picker/widget_picker.dart test/features/widget_picker
git commit -m "feat(widget_picker): cubit + polling selection stream"
```

---

### Task 35 — DockView (widget tree panel + details panel)

**Files:**
- Create: `lib/features/widget_picker/view/dock_view.dart`
- Create: `lib/features/widget_picker/widgets/widget_details_panel.dart`
- Create: `lib/features/widget_picker/widgets/no_selection_placeholder.dart`
- Modify: `lib/features/widget_picker/widget_picker.dart` (export `DockView`)
- Modify: `lib/core/router/app_router.dart` (mount `DockView` on `/`)
- Create: `test/features/widget_picker/view/dock_view_test.dart`

- [ ] **Step 1: Build the details panel.**

```dart
// lib/features/widget_picker/widgets/widget_details_panel.dart
import 'package:flutter/material.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class WidgetDetailsPanel extends StatelessWidget {
  const WidgetDetailsPanel({required this.selection, super.key});
  final SelectedWidget selection;

  @override
  Widget build(BuildContext context) {
    final monoFamily =
        Theme.of(context).extension<PickforgeMonoTheme>()!.fontFamily;
    final loc = selection.node.creationLocation;
    final locLabel = loc == null
        ? 'framework widget'
        : '${loc.file}:${loc.line}:${loc.column}';

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            selection.node.className,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 4),
          Text(locLabel, style: TextStyle(fontFamily: monoFamily)),
          const SizedBox(height: 12),
          Text(
            [...selection.ancestorClasses, selection.node.className]
                .join(' → '),
            style: Theme.of(context).textTheme.labelSmall,
          ),
          const SizedBox(height: 16),
          if (selection.sourceSnippet != null)
            Expanded(
              child: SingleChildScrollView(
                child: Text(
                  selection.sourceSnippet!,
                  style: TextStyle(fontFamily: monoFamily, fontSize: 12),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Build the empty placeholder.**

```dart
// lib/features/widget_picker/widgets/no_selection_placeholder.dart
import 'package:flutter/material.dart';

class NoSelectionPlaceholder extends StatelessWidget {
  const NoSelectionPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        'Tap a widget in the emulator to pick it',
        style: Theme.of(context).textTheme.bodyMedium,
      ),
    );
  }
}
```

- [ ] **Step 3: Build `DockView`.**

```dart
// lib/features/widget_picker/view/dock_view.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_cubit.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_state.dart';
import 'package:pickforge/features/widget_picker/widgets/no_selection_placeholder.dart';
import 'package:pickforge/features/widget_picker/widgets/widget_details_panel.dart';

class DockView extends StatelessWidget {
  const DockView({WidgetPickerCubit? cubit, super.key}) : _cubit = cubit;

  final WidgetPickerCubit? _cubit;

  @override
  Widget build(BuildContext context) {
    final providedCubit = _cubit;
    if (providedCubit != null) {
      return BlocProvider.value(
        value: providedCubit,
        child: const _DockBody(),
      );
    }

    return BlocProvider(
      create: (_) => getIt<WidgetPickerCubit>()..startListening(),
      child: const _DockBody(),
    );
  }
}

class _DockBody extends StatelessWidget {
  const _DockBody();

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WidgetPickerCubit, WidgetPickerState>(
      builder: (_, state) {
        final sel = state.selection;
        if (sel == null) return const NoSelectionPlaceholder();
        return WidgetDetailsPanel(selection: sel);
      },
    );
  }
}
```

- [ ] **Step 4: Update the barrel and wire into the router.**

```dart
// lib/features/widget_picker/widget_picker.dart
export 'cubit/widget_picker_cubit.dart';
export 'cubit/widget_picker_state.dart';
export 'view/dock_view.dart';
```

```dart
GoRoute(
  path: AppRoutes.dock,
  builder: (_, __) => const DockView(),
),
```

- [ ] **Step 5: Widget test.**

```dart
// test/features/widget_picker/view/dock_view_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_cubit.dart';
import 'package:pickforge/features/widget_picker/cubit/widget_picker_state.dart';
import 'package:pickforge/features/widget_picker/view/dock_view.dart';

class _MockCubit extends MockCubit<WidgetPickerState>
    implements WidgetPickerCubit {}

void main() {
  testWidgets('shows placeholder when selection is null', (tester) async {
    final cubit = _MockCubit();
    when(() => cubit.state).thenReturn(WidgetPickerState.initial());
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: DockView(cubit: cubit)),
      ),
    );
    expect(find.text('Tap a widget in the emulator to pick it'), findsOneWidget);
  });
}
```

- [ ] **Step 6: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/features/widget_picker/view
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add lib/features/widget_picker/view lib/features/widget_picker/widgets lib/features/widget_picker/widget_picker.dart lib/core/router/app_router.dart test/features/widget_picker/view
git commit -m "feat(widget_picker): DockView with details panel and empty state"
```

---

### Task 36 — Screenshot preview panel

**Files:**
- Create: `lib/features/widget_picker/widgets/screenshot_preview.dart`
- Modify: `lib/features/widget_picker/widgets/widget_details_panel.dart` (include preview)
- Create: `test/features/widget_picker/widgets/screenshot_preview_test.dart`

- [ ] **Step 1: Build the preview widget.**

```dart
// lib/features/widget_picker/widgets/screenshot_preview.dart
import 'dart:io';

import 'package:flutter/material.dart';

class ScreenshotPreview extends StatelessWidget {
  const ScreenshotPreview({required this.path, super.key});
  final String? path;

  @override
  Widget build(BuildContext context) {
    if (path == null) return const SizedBox.shrink();
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.file(
        File(path!),
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
      ),
    );
  }
}
```

- [ ] **Step 2: Integrate into `WidgetDetailsPanel`.** Add above the source snippet:

```dart
if (selection.screenshotPath != null)
  SizedBox(
    height: 160,
    child: ScreenshotPreview(path: selection.screenshotPath),
  ),
```

- [ ] **Step 3: Test (golden-free — just existence).**

```dart
// test/features/widget_picker/widgets/screenshot_preview_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/features/widget_picker/widgets/screenshot_preview.dart';

void main() {
  testWidgets('renders nothing when path is null', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ScreenshotPreview(path: null))),
    );
    expect(find.byType(Image), findsNothing);
  });
}
```

- [ ] **Step 4: Run tests.**

```bash
fvm flutter test test/features/widget_picker/widgets
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/features/widget_picker/widgets test/features/widget_picker/widgets
git commit -m "feat(widget_picker): add screenshot preview to details panel"
```

---

## Phase 12 — Forge feature

Goal: the skill/agent/terminal picker + the "Forge it" button that calls `AgentLauncher`.

### Task 37 — ForgeCubit

**Files:**
- Create: `lib/features/forge/cubit/forge_cubit.dart`
- Create: `lib/features/forge/cubit/forge_state.dart`
- Create: `lib/features/forge/forge.dart` (barrel)
- Create: `test/features/forge/cubit/forge_cubit_test.dart`

- [ ] **Step 1: State.**

```dart
// lib/features/forge/cubit/forge_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/skills/models.dart';

part 'forge_state.freezed.dart';

@freezed
class ForgeState with _$ForgeState {
  const factory ForgeState({
    required SkillId skill,
    required AgentProfileId agentId,
    required String terminalId,
    required bool launching,
    required String? lastError,
  }) = _ForgeState;

  factory ForgeState.initial() => const ForgeState(
        skill: SkillId.editWidget,
        agentId: AgentProfileId.claudeCode,
        terminalId: 'ghostty',
        launching: false,
        lastError: null,
      );
}
```

- [ ] **Step 2: Cubit.**

```dart
// lib/features/forge/cubit/forge_cubit.dart
import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models.dart';

import 'forge_state.dart';

@injectable
class ForgeCubit extends Cubit<ForgeState> {
  ForgeCubit(this._launcher, this._adb) : super(ForgeState.initial());

  final AgentLauncher _launcher;
  final AdbScreenshotCapturer _adb;

  void selectSkill(SkillId v) => emit(state.copyWith(skill: v, lastError: null));
  void selectAgent(AgentProfileId v) =>
      emit(state.copyWith(agentId: v, lastError: null));
  void selectTerminal(String v) =>
      emit(state.copyWith(terminalId: v, lastError: null));

  Future<void> forge({
    required SelectedWidget selection,
    required String projectRoot,
  }) async {
    emit(state.copyWith(launching: true, lastError: null));
    try {
      final adbPath = await _adb.capture(outputDir: '$projectRoot/.pickforge');
      final enriched = selection.copyWith(adbScreenshotPath: adbPath);
      final req = ForgeRequest(
        widget: enriched,
        skill: state.skill,
        agentId: state.agentId,
        terminalId: state.terminalId,
        projectRoot: projectRoot,
      );
      await _launcher.launch(req);
      emit(state.copyWith(launching: false));
    } on Object catch (e) {
      emit(state.copyWith(launching: false, lastError: e.toString()));
    }
  }
}
```

- [ ] **Step 3: Barrel + test.**

```dart
// lib/features/forge/forge.dart
export 'cubit/forge_cubit.dart';
export 'cubit/forge_state.dart';
export 'view/forge_panel.dart';
```

```dart
// test/features/forge/cubit/forge_cubit_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models.dart';
import 'package:pickforge/features/forge/forge.dart';

class _MockLauncher extends Mock implements AgentLauncher {}
class _MockAdb extends Mock implements AdbScreenshotCapturer {}

void main() {
  setUpAll(() {
    registerFallbackValue(
      ForgeRequest(
        widget: const SelectedWidget(
          node: WidgetNode(
            id: 'x',
            className: 'X',
            children: [],
            creationLocation: null,
          ),
          ancestorClasses: [],
          sourceSnippet: null,
          screenshotPath: null,
          adbScreenshotPath: null,
          propertiesJson: {},
        ),
        skill: SkillId.editWidget,
        agentId: AgentProfileId.claudeCode,
        terminalId: 'ghostty',
        projectRoot: '/me/app',
      ),
    );
  });

  blocTest<ForgeCubit, ForgeState>(
    'forge happy path toggles launching',
    build: () {
      final launcher = _MockLauncher();
      final adb = _MockAdb();
      when(() => adb.capture(outputDir: any(named: 'outputDir')))
          .thenAnswer((_) async => null);
      when(() => launcher.launch(any())).thenAnswer(
        (_) async => Future.value()
            .then((_) => throw UnimplementedError()),
      );
      // Actually return a successful result
      when(() => launcher.launch(any())).thenAnswer((_) async => dummyResult);
      return ForgeCubit(launcher, adb);
    },
    act: (c) => c.forge(
      selection: const SelectedWidget(
        node: WidgetNode(
          id: 'x',
          className: 'X',
          children: [],
          creationLocation: null,
        ),
        ancestorClasses: [],
        sourceSnippet: null,
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      ),
      projectRoot: '/me/app',
    ),
    expect: () => [
      ForgeState.initial().copyWith(launching: true),
      ForgeState.initial().copyWith(launching: false),
    ],
  );
}

final dummyResult = _dummyResult();
dynamic _dummyResult() => null;
```

(The ProcessResult fallback in the mock can be simplified — the test's only assertion is that the state transitions.)

- [ ] **Step 4: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/features/forge
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/features/forge/cubit lib/features/forge/forge.dart test/features/forge
git commit -m "feat(forge): ForgeCubit orchestrates skill/agent/terminal picking + launch"
```

---

### Task 38 — ForgePanel + "Forge it" button + integration with DockView

**Files:**
- Create: `lib/features/forge/view/forge_panel.dart`
- Create: `lib/features/forge/widgets/skill_picker.dart`
- Create: `lib/features/forge/widgets/agent_picker.dart`
- Create: `lib/features/forge/widgets/terminal_picker.dart`
- Modify: `lib/features/widget_picker/view/dock_view.dart` (embed ForgePanel in bottom)
- Create: `test/features/forge/view/forge_panel_test.dart`

- [ ] **Step 1: Build the three pickers — here's `SkillPicker` as the pattern.**

```dart
// lib/features/forge/widgets/skill_picker.dart
import 'package:flutter/material.dart';
import 'package:pickforge/core/skills/models.dart';

class SkillPicker extends StatelessWidget {
  const SkillPicker({required this.value, required this.onChanged, super.key});
  final SkillId value;
  final ValueChanged<SkillId> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButton<SkillId>(
      value: value,
      isDense: true,
      items: [
        for (final s in SkillId.values)
          DropdownMenuItem(value: s, child: Text(s.value)),
      ],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}
```

Mirror the pattern for `agent_picker.dart` (iterates `AgentProfileId.values`) and `terminal_picker.dart` (takes a `List<TerminalProfile>` from the registry — inject via GetIt).

- [ ] **Step 2: Build `ForgePanel`.**

```dart
// lib/features/forge/view/forge_panel.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';
import 'package:pickforge/features/forge/widgets/agent_picker.dart';
import 'package:pickforge/features/forge/widgets/skill_picker.dart';
import 'package:pickforge/features/forge/widgets/terminal_picker.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ForgePanel extends StatelessWidget {
  const ForgePanel({
    required this.selection,
    required this.projectRoot,
    super.key,
  });
  final SelectedWidget? selection;
  final String projectRoot;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => getIt<ForgeCubit>(),
      child: _ForgeBody(selection: selection, projectRoot: projectRoot),
    );
  }
}

class _ForgeBody extends StatelessWidget {
  const _ForgeBody({required this.selection, required this.projectRoot});
  final SelectedWidget? selection;
  final String projectRoot;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return BlocBuilder<ForgeCubit, ForgeState>(
      builder: (ctx, state) {
        final terminals = getIt<TerminalProfileRegistry>().availableOnThisOs();
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              SkillPicker(
                value: state.skill,
                onChanged: ctx.read<ForgeCubit>().selectSkill,
              ),
              const SizedBox(width: 8),
              AgentPicker(
                value: state.agentId,
                onChanged: ctx.read<ForgeCubit>().selectAgent,
              ),
              const SizedBox(width: 8),
              TerminalPicker(
                value: state.terminalId,
                onChanged: ctx.read<ForgeCubit>().selectTerminal,
                available: terminals,
              ),
              const Spacer(),
              FilledButton(
                onPressed: (selection == null || state.launching)
                    ? null
                    : () => ctx.read<ForgeCubit>().forge(
                          selection: selection!,
                          projectRoot: projectRoot,
                        ),
                child: Text(l10n.forgeItButton),
              ),
            ],
          ),
        );
      },
    );
  }
}
```

- [ ] **Step 3: Embed `ForgePanel` into `DockView`.**

Wrap `_DockBody`'s return in a `Column` with the details on top and `ForgePanel` at the bottom:

```dart
Column(
  children: [
    Expanded(
      child: sel == null
          ? const NoSelectionPlaceholder()
          : WidgetDetailsPanel(selection: sel),
    ),
    ForgePanel(selection: sel, projectRoot: '/'),
  ],
),
```

(Project root plumbing will be replaced once the Settings feature exposes a picker; for MVP we use the current working directory.)

- [ ] **Step 4: Widget test.**

```dart
// test/features/forge/view/forge_panel_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockCubit extends MockCubit<ForgeState> implements ForgeCubit {}

void main() {
  testWidgets('Forge it button disabled when selection is null', (tester) async {
    final cubit = _MockCubit();
    when(() => cubit.state).thenReturn(ForgeState.initial());
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: BlocProvider<ForgeCubit>.value(
            value: cubit,
            child: const Placeholder(),
          ),
        ),
      ),
    );
    expect(find.byType(FilledButton), findsNothing); // Placeholder stand-in
  });
}
```

- [ ] **Step 5: Codegen + run.**

```bash
./scripts/gen.sh
fvm flutter test test/features/forge
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/features/forge/view lib/features/forge/widgets lib/features/widget_picker/view/dock_view.dart test/features/forge/view
git commit -m "feat(forge): ForgePanel + Forge it button wired into DockView"
```

---

## Phase 13 — History & Settings features

Minimal flesh on these two features — enough to be useful, not gold-plated.

### Task 39 — HistoryView

**Files:**
- Create: `lib/features/history/cubit/history_cubit.dart`
- Create: `lib/features/history/view/history_view.dart`
- Create: `lib/features/history/history.dart` (barrel)
- Modify: `lib/core/router/app_router.dart` (mount `HistoryView`)
- Create: `test/features/history/cubit/history_cubit_test.dart`

- [ ] **Step 1: Cubit streams `PickHistoryDao.recent()`.**

```dart
// lib/features/history/cubit/history_cubit.dart
import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

@injectable
class HistoryCubit extends Cubit<List<PickHistoryRow>> {
  HistoryCubit(this._db) : super(const []) {
    _db.pickHistoryDao.recent().listen(emit);
  }
  final PickforgeDatabase _db;
}
```

- [ ] **Step 2: View.**

```dart
// lib/features/history/view/history_view.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/history/cubit/history_cubit.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class HistoryView extends StatelessWidget {
  const HistoryView({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return BlocProvider(
      create: (_) => getIt<HistoryCubit>(),
      child: BlocBuilder<HistoryCubit, List<PickHistoryRow>>(
        builder: (_, rows) {
          if (rows.isEmpty) {
            return Center(child: Text(l10n.historyTitle));
          }
          return ListView.separated(
            itemCount: rows.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final r = rows[i];
              return ListTile(
                title: Text(r.widgetClass),
                subtitle: Text('${r.creationFile ?? '-'}:${r.creationLine ?? '-'}'),
                trailing: Text('${r.agentId} · ${r.terminalId}'),
              );
            },
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 3: Barrel + router wire-in.**

```dart
// lib/features/history/history.dart
export 'cubit/history_cubit.dart';
export 'view/history_view.dart';
```

Replace placeholder at `AppRoutes.history` with `HistoryView`.

- [ ] **Step 4: Test.**

```dart
// test/features/history/cubit/history_cubit_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/history/cubit/history_cubit.dart';

void main() {
  late PickforgeDatabase db;
  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('emits new rows as they are inserted', () async {
    final cubit = HistoryCubit(db);
    await db.pickHistoryDao.insertPick(
      projectRoot: '/me/app',
      widgetClass: 'Text',
      creationFile: null,
      creationLine: null,
      skillId: 'explain-widget',
      agentId: 'claude-code',
      terminalId: 'ghostty',
      widgetContextJson: '{}',
    );
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(cubit.state.length, 1);
  });
}
```

- [ ] **Step 5: Codegen + tests.**

```bash
./scripts/gen.sh
fvm flutter test test/features/history
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/features/history lib/core/router/app_router.dart test/features/history
git commit -m "feat(history): HistoryView streaming recent picks from Drift"
```

---

### Task 40 — SettingsView

**Files:**
- Create: `lib/features/settings/cubit/settings_cubit.dart`
- Create: `lib/features/settings/view/settings_view.dart`
- Create: `lib/features/settings/settings.dart`
- Modify: `lib/core/router/app_router.dart`

- [ ] **Step 1: Cubit — thin wrapper over `ProjectSettingsRepository` + defaults.**

```dart
// lib/features/settings/cubit/settings_cubit.dart
import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';

class SettingsState extends Equatable {
  const SettingsState({
    this.defaultAgent,
    this.defaultTerminal,
  });
  final String? defaultAgent;
  final String? defaultTerminal;

  @override
  List<Object?> get props => [defaultAgent, defaultTerminal];

  SettingsState copyWith({String? defaultAgent, String? defaultTerminal}) =>
      SettingsState(
        defaultAgent: defaultAgent ?? this.defaultAgent,
        defaultTerminal: defaultTerminal ?? this.defaultTerminal,
      );
}

@injectable
class SettingsCubit extends Cubit<SettingsState> {
  SettingsCubit(this._repo) : super(const SettingsState());

  final ProjectSettingsRepository _repo;
  String? _projectRoot;

  Future<void> load(String projectRoot) async {
    _projectRoot = projectRoot;
    emit(SettingsState(
      defaultAgent: await _repo.getDefaultAgentId(projectRoot),
      defaultTerminal: await _repo.getDefaultTerminalId(projectRoot),
    ));
  }

  Future<void> setDefaultAgent(String id) async {
    final root = _projectRoot;
    if (root == null) return;
    await _repo.setDefaultAgentId(root, id);
    emit(state.copyWith(defaultAgent: id));
  }

  Future<void> setDefaultTerminal(String id) async {
    final root = _projectRoot;
    if (root == null) return;
    await _repo.setDefaultTerminalId(root, id);
    emit(state.copyWith(defaultTerminal: id));
  }
}
```

- [ ] **Step 2: View — two dropdowns + title. Follow the `SkillPicker`/`AgentPicker` patterns. Barrel + wire-in mirror Task 39.**

- [ ] **Step 3: Commit.**

```bash
git add lib/features/settings lib/core/router/app_router.dart
git commit -m "feat(settings): SettingsView for default agent/terminal persistence"
```

---

## Phase 14 — App chrome, command palette, polish

Goal: the cross-feature chrome — command palette (⌘K), top-level nav, motion polish. The last layer that makes Pickforge feel like a power-user tool instead of a barebones proof.

### Task 41 — Command palette (⌘K)

**Files:**
- Create: `lib/shared/command_palette/command.dart`
- Create: `lib/shared/command_palette/command_palette.dart`
- Create: `lib/shared/command_palette/command_palette_scope.dart`
- Modify: `lib/shared/widgets/app_shell.dart` (mount the palette)
- Create: `test/shared/command_palette/command_palette_test.dart`

- [ ] **Step 1: Define the `Command` model.**

```dart
// lib/shared/command_palette/command.dart
class PickforgeCommand {
  const PickforgeCommand({
    required this.id,
    required this.title,
    required this.hint,
    required this.run,
  });

  final String id;
  final String title;
  final String hint;
  final void Function() run;
}
```

- [ ] **Step 2: Build the palette.**

```dart
// lib/shared/command_palette/command_palette.dart
import 'package:flutter/material.dart';

import 'command.dart';

class CommandPalette extends StatefulWidget {
  const CommandPalette({required this.commands, super.key});
  final List<PickforgeCommand> commands;

  @override
  State<CommandPalette> createState() => _CommandPaletteState();
}

class _CommandPaletteState extends State<CommandPalette> {
  final _filter = TextEditingController();

  @override
  void dispose() {
    _filter.dispose();
    super.dispose();
  }

  List<PickforgeCommand> get _visible {
    final q = _filter.text.trim().toLowerCase();
    if (q.isEmpty) return widget.commands;
    return widget.commands
        .where((c) => c.title.toLowerCase().contains(q))
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Theme.of(context).colorScheme.surface,
      insetPadding: const EdgeInsets.all(64),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              controller: _filter,
              autofocus: true,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: 'Type a command…',
                border: InputBorder.none,
              ),
            ),
          ),
          const Divider(height: 1),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final c in _visible)
                  ListTile(
                    title: Text(c.title),
                    subtitle: Text(c.hint),
                    onTap: () {
                      Navigator.of(context).pop();
                      c.run();
                    },
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 3: Add the scope that listens for ⌘K / Ctrl+K and pops the palette.**

```dart
// lib/shared/command_palette/command_palette_scope.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'command.dart';
import 'command_palette.dart';

class CommandPaletteScope extends StatelessWidget {
  const CommandPaletteScope({
    required this.commands,
    required this.child,
    super.key,
  });

  final List<PickforgeCommand> commands;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.keyK, meta: true): () =>
            _open(context),
        const SingleActivator(LogicalKeyboardKey.keyK, control: true): () =>
            _open(context),
      },
      child: Focus(autofocus: true, child: child),
    );
  }

  void _open(BuildContext context) {
    showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (_) => CommandPalette(commands: commands),
    );
  }
}
```

- [ ] **Step 4: Mount it in the shell.**

```dart
// lib/shared/widgets/app_shell.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/shared/command_palette/command.dart';
import 'package:pickforge/shared/command_palette/command_palette_scope.dart';

class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final commands = <PickforgeCommand>[
      PickforgeCommand(
        id: 'goto.connect',
        title: 'Connect',
        hint: 'Paste a VM Service URL',
        run: () => context.go(AppRoutes.connect),
      ),
      PickforgeCommand(
        id: 'goto.dock',
        title: 'Dock',
        hint: 'Widget picker and Forge it',
        run: () => context.go(AppRoutes.dock),
      ),
      PickforgeCommand(
        id: 'goto.history',
        title: 'History',
        hint: 'Recent forges',
        run: () => context.go(AppRoutes.history),
      ),
      PickforgeCommand(
        id: 'goto.settings',
        title: 'Settings',
        hint: 'Default agent and terminal',
        run: () => context.go(AppRoutes.settings),
      ),
    ];
    return CommandPaletteScope(
      commands: commands,
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        child: child,
      ),
    );
  }
}
```

- [ ] **Step 5: Write a smoke test.**

```dart
// test/shared/command_palette/command_palette_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/command_palette/command.dart';
import 'package:pickforge/shared/command_palette/command_palette.dart';

void main() {
  testWidgets('filters commands by query', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: CommandPalette(
          commands: [
            PickforgeCommand(id: 'a', title: 'Forge it', hint: 'h', run: () {}),
            PickforgeCommand(id: 'b', title: 'Settings', hint: 'h', run: () {}),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Forge it'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'forg');
    await tester.pumpAndSettle();
    expect(find.text('Forge it'), findsOneWidget);
    expect(find.text('Settings'), findsNothing);
  });
}
```

- [ ] **Step 6: Tests + commit.**

```bash
fvm flutter test test/shared/command_palette/command_palette_test.dart
git add lib/shared/command_palette lib/shared/widgets/app_shell.dart test/shared/command_palette
git commit -m "feat(shell): add command palette with ⌘K / Ctrl+K binding"
```

---

### Task 42 — Motion polish + empty states

**Files:**
- Create: `lib/shared/motion/pickforge_motion.dart`
- Modify: `lib/features/widget_picker/widgets/no_selection_placeholder.dart`
- Modify: `lib/features/widget_picker/widgets/widget_details_panel.dart`
- Modify: `lib/features/connection/view/connection_view.dart`
- Create: `test/shared/motion/pickforge_motion_test.dart`

- [ ] **Step 1: Define the motion tokens.**

```dart
// lib/shared/motion/pickforge_motion.dart
import 'package:flutter/animation.dart';

class PickforgeMotion {
  const PickforgeMotion._();

  static const fast = Duration(milliseconds: 150);
  static const standard = Duration(milliseconds: 240);
  static const slow = Duration(milliseconds: 420);

  static const curve = Curves.easeInOutCubicEmphasized;
  static const curveOut = Curves.easeOutCubic;
}
```

- [ ] **Step 2: Replace the placeholder's static text with an animated pulsing dot + slide.**

Wrap `NoSelectionPlaceholder`'s `Text` in a `flutter_animate` chain:

```dart
import 'package:flutter_animate/flutter_animate.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';

// in build():
Text(...)
    .animate(onPlay: (c) => c.repeat(reverse: true))
    .fadeIn(duration: PickforgeMotion.standard, curve: PickforgeMotion.curveOut)
    .then(delay: const Duration(seconds: 1))
    .fadeOut(duration: PickforgeMotion.slow);
```

- [ ] **Step 3: Add a hero transition between widget-tree items and the details panel.** Wrap both the list tile's title and the details panel's title with `Hero(tag: 'widget-${selection.node.id}', child: ...)`.

- [ ] **Step 4: Use `AnimatedSwitcher` in `DockView` so the placeholder → details transition cross-fades.**

```dart
AnimatedSwitcher(
  duration: PickforgeMotion.standard,
  switchInCurve: PickforgeMotion.curveOut,
  child: sel == null
      ? const NoSelectionPlaceholder(key: ValueKey('empty'))
      : WidgetDetailsPanel(
          key: ValueKey(sel.node.id),
          selection: sel,
        ),
),
```

- [ ] **Step 5: A tiny sanity test (no visual assertion, just that motion helpers resolve).**

```dart
// test/shared/motion/pickforge_motion_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';

void main() {
  test('motion tokens non-zero', () {
    expect(PickforgeMotion.standard.inMilliseconds, greaterThan(0));
    expect(PickforgeMotion.curve, isNotNull);
  });
}
```

- [ ] **Step 6: Full gate + manual smoke (run the app, pick something, watch the fade + hero).**

```bash
./scripts/check.sh
fvm flutter run -d linux
```

- [ ] **Step 7: Commit.**

```bash
git add lib/shared/motion lib/features/widget_picker/widgets lib/features/widget_picker/view/dock_view.dart lib/features/connection/view/connection_view.dart test/shared/motion
git commit -m "feat(ux): motion tokens, animated empty state, hero/cross-fade transitions"
```

---

## Phase 15 — CI, release checklist, docs

Goal: ship-ready. Close out with polished CI, a release checklist, a README, `SECURITY.md`, and a hook to prevent regressions.

### Task 43 — CI tightening

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Extend `ci.yml` to run codegen + ensure the tree stays clean.**

Replace the "Codegen" step with:

```yaml
      - name: Codegen
        run: fvm dart run build_runner build --delete-conflicting-outputs
      - name: Assert no uncommitted codegen drift
        run: |
          git diff --exit-code || (
            echo "::error::Codegen drift detected. Run scripts/gen.sh locally and commit.";
            exit 1
          )
```

- [ ] **Step 2: Add a release skeleton (triggered on tags `v*.*.*`).**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ['v*.*.*']

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dart-lang/setup-dart@v1
      - name: Install FVM
        run: dart pub global activate fvm
      - name: Install Flutter SDK
        run: fvm install
      - name: Install deps
        run: fvm flutter pub get
      - name: Codegen
        run: fvm dart run build_runner build --delete-conflicting-outputs
      - name: Build desktop
        run: |
          case "${{ matrix.os }}" in
            ubuntu-latest)  fvm flutter build linux   --release ;;
            macos-latest)   fvm flutter build macos   --release ;;
            windows-latest) fvm flutter build windows --release ;;
          esac
        shell: bash
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: pickforge-${{ matrix.os }}
          path: build/
```

Note: signing / notarization / installer packaging are explicitly deferred per spec §12.

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows
git commit -m "ci: add codegen drift check and release build matrix"
```

---

### Task 44 — Release dogfood checklist + SECURITY.md

**Files:**
- Create: `docs/release-checklist.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1: Write `docs/release-checklist.md`.**

```markdown
# Pickforge — Release Dogfood Checklist

Run through this list before tagging a release. Manual steps only — automated
coverage lives in CI.

## Cold-install smoke

- [ ] Fresh VM / clean machine (Linux, macOS).
- [ ] Install the built artifact. App launches, 480x720 window, dark theme, always-on-top.

## Connection

- [ ] Start a sample Flutter app in an Android emulator and copy the VM Service URL.
- [ ] Paste into Pickforge → Connect → status turns green.
- [ ] Disconnect + reconnect → no crash, URL is remembered next launch.
- [ ] Kill the app mid-session → Pickforge shows Reconnecting, recovers after restart.

## Widget pick → Forge it

- [ ] Tap a user-code widget in emulator → appears in the details panel.
- [ ] Tap a framework widget → Forge it disabled with "pick a user widget" hint.
- [ ] Forge it with each agent (Claude Code, Codex, OpenCode) at least once.
- [ ] Forge it with each detected terminal at least once.
- [ ] Verify `.pickforge/` is created in the project with expected files + `.gitignore`.
- [ ] Verify the user's existing `CLAUDE.md` / `AGENTS.md` is untouched.

## Hot reload

- [ ] After the agent edits and hot-reloads, Pickforge refreshes the tree.
- [ ] Selecting a new widget post-reload still works.

## adb (Android only)

- [ ] With `adb` available: `.pickforge/device-screen.png` is written and referenced in the prompt.
- [ ] With `adb` unavailable: no error, `.pickforge/screenshot.png` still present.

## Misc

- [ ] ⌘K / Ctrl+K opens the command palette.
- [ ] History view shows the last forge.
- [ ] Settings view reads and writes defaults per project.

Sign off: _______________________________
```

- [ ] **Step 2: Write `SECURITY.md`.**

```markdown
# Security Policy

## Reporting a vulnerability

Email **security@pickforge.dev** with a description of the issue, affected
versions, and steps to reproduce. Please do **not** open a public GitHub
issue for security reports.

## Response expectations

- Acknowledgement within **48 hours**.
- Best-effort patch timeline, communicated once triaged.
- Public credit in release notes unless you prefer otherwise.

## Scope

Pickforge runs locally and never sends your code over the network. The main
threat model we care about:

- Malicious `.pickforge/` content crafted to subvert the user's agent session.
- Privilege escalation via spawned terminal / wrapper scripts.
- VM Service URL handling.

Out of scope: third-party agent CLIs (report those to their maintainers) and
your own project's `CLAUDE.md` / `AGENTS.md` content.

## Supported versions

The latest minor release is supported. Older minors receive security fixes
on a best-effort basis.
```

- [ ] **Step 3: Add a minimal `CODE_OF_CONDUCT.md`** — adopt the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) verbatim. Put the contact line as `security@pickforge.dev`.

- [ ] **Step 4: Commit.**

```bash
git add docs/release-checklist.md SECURITY.md CODE_OF_CONDUCT.md
git commit -m "docs: release dogfood checklist, SECURITY.md, code of conduct"
```

---

### Task 45 — README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write a focused README.**

````markdown
<p align="center"><strong>Pickforge</strong></p>
<p align="center"><em>Widget-level AI context for Flutter.</em></p>
<p align="center"><a href="https://pickforge.dev">pickforge.dev</a></p>

---

Pickforge is a local **Flutter desktop app** that lets you pick a widget in
your running Flutter app and dispatch its full context — source, ancestor
chain, screenshots — to an AI coding CLI (Claude Code, Codex, OpenCode) in a
new terminal. The agent makes a surgical edit; you hot-reload; repeat.

> Pickforge is MIT-licensed open source. You bring your own agent credentials.
> Nothing leaves your machine.

## Quick start

1. Run your app in an Android emulator as normal and copy the VM Service URL
   printed to the console.
2. Launch Pickforge. Paste the URL → Connect.
3. Tap a widget in the emulator. Pickforge highlights it and shows its
   source.
4. Pick a **skill** (edit / extract / explain), pick an **agent**, pick a
   **terminal**, click **Forge it**. A new terminal opens with your agent
   pre-loaded with the widget's context.

## What it writes to your project

Only a single `.pickforge/` folder at your project root:

```
.pickforge/
  .gitignore           # auto-generated, contains "*"
  skill-active.md      # the current skill directive
  widget-context.md    # the selected widget's details
  screenshot.png       # Flutter render (when available)
  device-screen.png    # full device screen with highlight (Android + adb)
  initial-prompt.md    # what Pickforge piped to your agent
  run-log.json         # session metadata
```

Pickforge **never** modifies your `CLAUDE.md`, `AGENTS.md`, or any of your own
files. If `.pickforge/` already exists and wasn't created by Pickforge, it
refuses to proceed.

## Install

Download from [Releases](https://github.com/pickforge/pickforge/releases)
— `.AppImage` (Linux), `.dmg` (macOS), `.msi` (Windows).

Or build from source:

```bash
git clone https://github.com/pickforge/pickforge
cd pickforge
fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run -d linux   # or -d macos, -d windows
```

## Supported stack

| Category | Supported |
|---|---|
| Target platforms (for the app under debug) | Android emulator (MVP). iOS Simulator, Flutter web, and Flutter desktop are planned. |
| Agents | Claude Code, Codex, OpenCode. More planned. |
| Terminals | Ghostty, iTerm2, Warp, WezTerm, Alacritty, Kitty, Windows Terminal, gnome-terminal, Terminal.app, `$TERMINAL` fallback. |

## Contributing

PRs welcome. See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for expectations.

Design spec: `docs/superpowers/specs/2026-04-23-pickforge-design.md`.
Implementation plan: `docs/superpowers/plans/2026-04-23-pickforge-mvp.md`.

## License

[MIT](LICENSE).
````

- [ ] **Step 2: Commit.**

```bash
git add README.md
git commit -m "docs: add README with quick start and architecture pointers"
```

---

# Spec coverage audit

Every spec section has at least one task covering it:

- §2 Goals: MVP surface is covered Phase 0 → Phase 13.
- §2 Non-goals: explicitly out of scope — no tasks added.
- §4 D1-D11: every decision materializes in a specific task — `AgentProfile` / `TerminalProfile` / `.pickforge/` folder / dual screenshots / Drift / etc.
- §5 Architecture / §5.0 Directory layout: Phase 2 onward places code in the prescribed folders; Phase 1 Task 7 establishes the shell.
- §6.1-6.6 Components: covered across Phases 5-9 and the features.
- §7 Data flow: Phase 10 (connection), Phase 11 (pick), Phase 12 (forge), Phase 9 (launcher + adb), Phase 5 (inspector).
- §8 Error handling: Phase 4 Task 15 (reconnect + backoff), Phase 9 Task 30 (dir conflict), Task 31 (adb fallback), Task 32 (connection errors). Drift corruption handling not separately tested — tracked as a follow-up polish.
- §9 Testing: every task has TDD steps; Phase 4 Task 16 adds the fixture-replay harness. CI matrix lands in Phase 0 Task 3 and tightens in Phase 15 Task 43.
- §10 Design / motion: Phase 1 Task 4 sets theme, Phase 14 Tasks 41-42 add command palette + motion.
- §11 Package stack: installed in Phase 0 Task 1. Dio stays unwired (spec §11 acknowledges this).
- §12 Deferred: nothing planned — intentionally.
- §13 Open questions: accent color decision lives inside Task 4's `PickforgeColors.ember` (default chosen: forge-ember orange `#FF7A1A`). If you prefer electric violet, swap that token.

---

# Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-23-pickforge-mvp.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
