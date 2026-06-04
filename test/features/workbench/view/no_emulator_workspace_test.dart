import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/features/emulator/view/connection_pill.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/view/project_file_explorer_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

import '../../../support/deterministic_workspace_fixtures.dart';

void main() {
  testWidgets('chats and project browsing work without emulator connection',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 700);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final fixture = await deterministicSidebarFixture(
      WorkspaceSidebarSettings.defaults,
    );
    addTearDown(fixture.projects.close);
    addTearDown(fixture.chats.close);
    addTearDown(fixture.sidebar.close);

    final explorer = ProjectFileExplorerCubit(
      projectRoot: deterministicAlphaRoot,
      scanner: const DeterministicProjectFileScanner(deterministicFileTree),
      opener: ProjectFileOpener(runner: const NoopEmulatorProcessRunner()),
    );
    addTearDown(explorer.close);
    await explorer.load();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MultiBlocProvider(
          providers: [
            BlocProvider<ProjectsCubit>.value(value: fixture.projects),
            BlocProvider<ChatsCubit>.value(value: fixture.chats),
            BlocProvider<WorkspaceSidebarCubit>.value(value: fixture.sidebar),
            BlocProvider<ProjectFileExplorerCubit>.value(value: explorer),
          ],
          child: const Scaffold(
            body: Row(
              children: [
                SizedBox(width: 360, child: ProjectsChatsPanel()),
                VerticalDivider(width: 1),
                SizedBox(width: 420, child: ProjectFileExplorerPanel()),
                VerticalDivider(width: 1),
                Expanded(child: ConnectionPill()),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('PROJECTS'), findsOneWidget);
    expect(find.text('alpha_app'), findsOneWidget);
    expect(find.text('Refine picker overlay'), findsOneWidget);
    expect(find.text('EXPLORER'), findsOneWidget);
    expect(find.text('Pick device'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Search files'),
      'main',
    );
    await tester.pumpAndSettle();

    expect(find.text('main.dart'), findsOneWidget);
  });
}
