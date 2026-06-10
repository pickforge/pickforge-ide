import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/projects/project_file_tree.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_cubit.dart';
import 'package:pickforge/features/workbench/view/project_file_explorer_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

void main() {
  testWidgets('renders tree and expands folders', (tester) async {
    final cubit = ProjectFileExplorerCubit(
      projectRoot: '/app',
      scanner: _FakeScanner(
        const [
          ProjectFileNode(
            path: '/app/lib',
            relativePath: 'lib',
            name: 'lib',
            isDirectory: true,
            children: [
              ProjectFileNode(
                path: '/app/lib/main.dart',
                relativePath: 'lib/main.dart',
                name: 'main.dart',
                isDirectory: false,
              ),
            ],
          ),
        ],
      ),
      opener: _FakeOpener(),
      rootExists: (_) => true,
    );
    await cubit.load();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider.value(
          value: cubit,
          child: const Scaffold(body: ProjectFileExplorerPanel()),
        ),
      ),
    );

    expect(find.text('EXPLORER'), findsOneWidget);
    expect(find.text('lib'), findsOneWidget);
    expect(find.text('main.dart'), findsNothing);

    await tester.tap(find.text('lib'));
    await tester.pumpAndSettle();

    expect(find.text('main.dart'), findsOneWidget);
  });
}

class _FakeScanner implements ProjectFileTreeScanner {
  _FakeScanner(this.nodes);

  final List<ProjectFileNode> nodes;

  @override
  int get maxDepth => 8;

  @override
  int get maxEntriesPerDirectory => 300;

  @override
  Future<List<ProjectFileNode>> scan(
    String projectRoot, {
    bool showHidden = false,
  }) async =>
      nodes;
}

class _FakeOpener implements ProjectFileOpener {
  @override
  Future<void> open(String path) async {}

  @override
  Future<void> reveal(String path) async {}
}
