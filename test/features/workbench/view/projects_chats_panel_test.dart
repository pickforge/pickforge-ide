// mocktail `when(() => x.method())` requires the wrapping closure.
// ignore_for_file: unnecessary_lambdas

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/main.dart' show shouldSyncChatsForProjects;
import 'package:pickforge/shared/theme/pickforge_theme.dart';

class _MockProjectsRepo extends Mock implements ProjectsRepository {}

class _MockChatsRepo extends Mock implements ChatsRepository {}

class _MockSettings extends Mock implements ProjectSettingsRepository {}

class _FakeSidebarSettingsRepository
    implements WorkspaceSidebarSettingsRepository {
  WorkspaceSidebarSettings settings = WorkspaceSidebarSettings.defaults;

  @override
  Future<WorkspaceSidebarSettings> load() async => settings;

  @override
  Future<void> save(WorkspaceSidebarSettings settings) async {
    this.settings = settings;
  }
}

ProjectRow _project(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026, 4, 25),
      lastOpenedAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

ChatRow _chat(
  String id,
  String project,
  String title, {
  ChatTaskStatus status = ChatTaskStatus.active,
  List<String> labels = const [],
  String? brief,
}) =>
    ChatRow(
      chatId: id,
      projectRoot: project,
      title: title,
      agentId: 'codex',
      status: status.name,
      labelsJson: encodeChatLabels(labels),
      taskBriefText: brief,
      createdAt: DateTime(2026, 4, 25),
      lastActivityAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

Widget _harness({
  required ProjectsCubit projectsCubit,
  required ChatsCubit chatsCubit,
  WorkspaceSidebarCubit? sidebarCubit,
  bool withProjectSyncListener = false,
  Key? screenshotKey,
  Size? panelSize,
  bool usePickforgeTheme = false,
  TextScaler? textScaler,
}) {
  final sidebar =
      sidebarCubit ?? WorkspaceSidebarCubit(_FakeSidebarSettingsRepository());
  Widget panel = const ProjectsChatsPanel();
  if (screenshotKey != null) {
    panel = RepaintBoundary(key: screenshotKey, child: panel);
  }
  if (panelSize != null) {
    panel = Center(child: SizedBox.fromSize(size: panelSize, child: panel));
  }
  Widget home = MultiBlocProvider(
    providers: [
      BlocProvider.value(value: projectsCubit),
      BlocProvider.value(value: chatsCubit),
      BlocProvider.value(value: sidebar),
    ],
    child: Builder(
      builder: (context) {
        final scaffold = Scaffold(body: panel);
        if (!withProjectSyncListener) return scaffold;
        return BlocListener<ProjectsCubit, ProjectsState>(
          listenWhen: shouldSyncChatsForProjects,
          listener: (context, state) {
            if (state is! ProjectsReady) return;
            unawaited(
              context.read<ChatsCubit>().syncProjects(
                    state.projects.map((p) => p.projectRoot).toList(),
                    defaultExpand: state.activeProjectRoot,
                  ),
            );
          },
          child: scaffold,
        );
      },
    ),
  );
  if (textScaler != null) {
    home = MediaQuery(
      data: MediaQueryData(textScaler: textScaler),
      child: home,
    );
  }
  return MaterialApp(
    theme: usePickforgeTheme ? PickforgeTheme.dark() : null,
    darkTheme: usePickforgeTheme ? PickforgeTheme.dark() : null,
    themeMode: usePickforgeTheme ? ThemeMode.dark : ThemeMode.system,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: home,
  );
}

class _SidebarFixture {
  const _SidebarFixture({
    required this.projectsCubit,
    required this.chatsCubit,
    required this.sidebarCubit,
  });

  final ProjectsCubit projectsCubit;
  final ChatsCubit chatsCubit;
  final WorkspaceSidebarCubit sidebarCubit;
}

class _ImageStats {
  const _ImageStats({
    required this.width,
    required this.height,
    required this.opaquePixels,
    required this.uniqueColors,
  });

  final int width;
  final int height;
  final int opaquePixels;
  final int uniqueColors;
}

Future<_SidebarFixture> _sidebarFixture(
  WorkspaceSidebarSettings settings,
) async {
  final projects = [
    _project('/workspace/alpha_app'),
    _project('/workspace/design_system'),
    _project('/workspace/shop_admin'),
  ];
  final chatsByProject = {
    '/workspace/alpha_app': [
      _chat('alpha-ui', '/workspace/alpha_app', 'Refine picker overlay'),
      _chat('alpha-terminal', '/workspace/alpha_app', 'Terminal prompt audit'),
    ],
    '/workspace/design_system': [
      _chat('design-colors', '/workspace/design_system', 'Color token pass'),
      _chat('design-density', '/workspace/design_system', 'Density review'),
    ],
    '/workspace/shop_admin': [
      _chat('shop-run', '/workspace/shop_admin', 'Run flow cleanup'),
    ],
  };
  final projectRoots = projects.map((project) => project.projectRoot).toList();

  final pRepo = _MockProjectsRepo();
  when(() => pRepo.list()).thenAnswer((_) async => projects);
  when(() => pRepo.touch(any<String>())).thenAnswer((_) async {});

  final cRepo = _MockChatsRepo();
  when(() => cRepo.list(any())).thenAnswer((invocation) async {
    final root = invocation.positionalArguments.single as String;
    return chatsByProject[root] ?? const <ChatRow>[];
  });

  final projectSettings = _MockSettings();
  when(() => projectSettings.getLastChatId(any()))
      .thenAnswer((_) async => 'alpha-ui');
  when(() => projectSettings.setLastChatId(any(), any()))
      .thenAnswer((_) async {});

  final sidebarRepo = _FakeSidebarSettingsRepository()..settings = settings;
  final sidebarCubit = WorkspaceSidebarCubit(sidebarRepo);
  await sidebarCubit.load();

  final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
  final chatsCubit = ChatsCubit(cRepo, projectSettings);
  await projectsCubit.load();
  await chatsCubit.syncProjects(
    projectRoots,
    defaultExpand: projectRoots.first,
  );
  projectRoots.skip(1).forEach(chatsCubit.toggleExpanded);

  return _SidebarFixture(
    projectsCubit: projectsCubit,
    chatsCubit: chatsCubit,
    sidebarCubit: sidebarCubit,
  );
}

Future<_ImageStats> _captureStats(WidgetTester tester, Key key) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(key),
  );
  final capture = await tester.runAsync(() async {
    final image = await boundary.toImage();
    final width = image.width;
    final height = image.height;
    final byteData = await image.toByteData();
    image.dispose();
    return (byteData: byteData, width: width, height: height);
  });
  if (capture == null || capture.byteData == null) {
    fail('Unable to read sidebar screenshot bytes.');
  }
  return _statsFor(
    capture.byteData!,
    width: capture.width,
    height: capture.height,
  );
}

_ImageStats _statsFor(
  ByteData byteData, {
  required int width,
  required int height,
}) {
  final bytes = byteData.buffer.asUint8List();
  final colors = <int>{};
  var opaquePixels = 0;
  for (var index = 0; index < bytes.length; index += 4) {
    final red = bytes[index];
    final green = bytes[index + 1];
    final blue = bytes[index + 2];
    final alpha = bytes[index + 3];
    if (alpha > 0) opaquePixels++;
    colors.add(red << 24 | green << 16 | blue << 8 | alpha);
  }
  return _ImageStats(
    width: width,
    height: height,
    opaquePixels: opaquePixels,
    uniqueColors: colors.length,
  );
}

void main() {
  testWidgets('renders projects header with empty state and "+" button',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => <ProjectRow>[]);
    final cRepo = _MockChatsRepo();
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('PROJECTS'), findsOneWidget);
    expect(find.text('Add your first project'), findsOneWidget);
  });

  testWidgets('tapping a project toggles expand and shows nested chats',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => [_project('/a')]);
    when(() => pRepo.touch(any<String>())).thenAnswer((_) async {});

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a'))
        .thenAnswer((_) async => [_chat('c1', '/a', 'Chat 1')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a']);
    chatsCubit.toggleExpanded('/a');

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('a'), findsOneWidget);
    expect(find.text('Chat 1'), findsOneWidget);
  });

  testWidgets('renders chat task metadata in the sidebar', (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer((_) async => [_project('/a')]);
    when(() => pRepo.touch(any<String>())).thenAnswer((_) async {});

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a')).thenAnswer(
      (_) async => [
        _chat(
          'c1',
          '/a',
          'Chat 1',
          status: ChatTaskStatus.waiting,
          labels: ['release'],
          brief: 'Sidebar polish',
        ),
      ],
    );
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a']);
    chatsCubit.toggleExpanded('/a');

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    expect(find.text('Waiting'), findsOneWidget);
    expect(find.text('Sidebar polish'), findsOneWidget);
    expect(find.text('release'), findsOneWidget);
  });

  testWidgets('chat tap waits for project switch before selecting chat',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer(
      (_) async => [_project('/a'), _project('/b')],
    );
    final touchCompleter = Completer<void>();
    when(() => pRepo.touch('/b')).thenAnswer((_) => touchCompleter.future);

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a')).thenAnswer((_) async => <ChatRow>[]);
    when(() => cRepo.list('/b'))
        .thenAnswer((_) async => [_chat('c-b', '/b', 'Chat B')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a', '/b']);
    chatsCubit.toggleExpanded('/b');

    await tester.pumpWidget(
      _harness(projectsCubit: projectsCubit, chatsCubit: chatsCubit),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Chat B'));
    await tester.pump();

    verifyNever(() => settings.setLastChatId('/b', 'c-b'));

    touchCompleter.complete();
    await tester.pumpAndSettle();

    verify(() => settings.setLastChatId('/b', 'c-b')).called(1);
  });

  testWidgets('app sync listener skips active-project-only chat taps',
      (tester) async {
    final pRepo = _MockProjectsRepo();
    when(() => pRepo.list()).thenAnswer(
      (_) async => [_project('/a'), _project('/b')],
    );
    when(() => pRepo.touch('/b')).thenAnswer((_) async {});

    final cRepo = _MockChatsRepo();
    when(() => cRepo.list('/a'))
        .thenAnswer((_) async => [_chat('c-a', '/a', 'Chat A')]);
    when(() => cRepo.list('/b'))
        .thenAnswer((_) async => [_chat('c-b', '/b', 'Chat B')]);
    final settings = _MockSettings();
    when(() => settings.getLastChatId(any())).thenAnswer((_) async => null);
    when(() => settings.setLastChatId(any(), any())).thenAnswer((_) async {});

    final projectsCubit = ProjectsCubit(pRepo, PtySessionPool());
    final chatsCubit = ChatsCubit(cRepo, settings);
    await projectsCubit.load();
    await chatsCubit.syncProjects(['/a', '/b']);
    chatsCubit.toggleExpanded('/b');
    clearInteractions(cRepo);

    await tester.pumpWidget(
      _harness(
        projectsCubit: projectsCubit,
        chatsCubit: chatsCubit,
        withProjectSyncListener: true,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Chat B'));
    await tester.pumpAndSettle();

    verifyNever(() => cRepo.list('/a'));
    verifyNever(() => cRepo.list('/b'));
    expect((chatsCubit.state as ChatsReady).activeChatId, 'c-b');
  });

  testWidgets('compact list layout renders a nonblank sidebar screenshot',
      (tester) async {
    const screenshotKey = Key('compact-sidebar-screenshot');
    final fixture = await _sidebarFixture(WorkspaceSidebarSettings.defaults);

    await tester.pumpWidget(
      _harness(
        projectsCubit: fixture.projectsCubit,
        chatsCubit: fixture.chatsCubit,
        sidebarCubit: fixture.sidebarCubit,
        screenshotKey: screenshotKey,
        panelSize: const Size(320, 560),
        usePickforgeTheme: true,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(tester.takeException(), isNull);
    expect(find.text('alpha_app'), findsOneWidget);
    expect(find.text('Refine picker overlay'), findsOneWidget);

    final stats = await _captureStats(tester, screenshotKey);
    expect(stats.width, 320);
    expect(stats.height, 560);
    expect(stats.opaquePixels, 320 * 560);
    expect(stats.uniqueColors, greaterThan(24));
  });

  testWidgets('comfortable grid layout renders a nonblank sidebar screenshot',
      (tester) async {
    const screenshotKey = Key('comfortable-grid-sidebar-screenshot');
    final fixture = await _sidebarFixture(
      const WorkspaceSidebarSettings(
        viewMode: WorkspaceSidebarViewMode.grid,
        density: WorkspaceSidebarDensity.comfortable,
      ),
    );

    await tester.pumpWidget(
      _harness(
        projectsCubit: fixture.projectsCubit,
        chatsCubit: fixture.chatsCubit,
        sidebarCubit: fixture.sidebarCubit,
        screenshotKey: screenshotKey,
        panelSize: const Size(360, 580),
        usePickforgeTheme: true,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(tester.takeException(), isNull);
    expect(find.text('design_system'), findsWidgets);
    expect(find.text('Color token pass'), findsOneWidget);

    final stats = await _captureStats(tester, screenshotKey);
    expect(stats.width, 360);
    expect(stats.height, 580);
    expect(stats.opaquePixels, 360 * 580);
    expect(stats.uniqueColors, greaterThan(24));
  });

  testWidgets('compact list layout supports large text without overflow',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 760);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    const screenshotKey = Key('large-text-sidebar-screenshot');
    final fixture = await _sidebarFixture(WorkspaceSidebarSettings.defaults);

    await tester.pumpWidget(
      _harness(
        projectsCubit: fixture.projectsCubit,
        chatsCubit: fixture.chatsCubit,
        sidebarCubit: fixture.sidebarCubit,
        screenshotKey: screenshotKey,
        panelSize: const Size(360, 640),
        usePickforgeTheme: true,
        textScaler: const TextScaler.linear(1.6),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(tester.takeException(), isNull);
    expect(find.text('alpha_app'), findsOneWidget);
    expect(find.text('Refine picker overlay'), findsOneWidget);

    final stats = await _captureStats(tester, screenshotKey);
    expect(stats.width, 360);
    expect(stats.height, 640);
    expect(stats.opaquePixels, 360 * 640);
    expect(stats.uniqueColors, greaterThan(24));
  });
}
