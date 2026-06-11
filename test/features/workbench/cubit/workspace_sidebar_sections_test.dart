import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_sections.dart';

void main() {
  test('groups chats by project by default', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/app')],
      chatsByProject: {
        '/app': [_chat('c1', '/app', 'Fix button')],
      },
      settings: WorkspaceSidebarSettings.defaults,
    );

    expect(sections.single.id, 'project:/app');
    expect(sections.single.entries.single.chat?.title, 'Fix button');
  });

  test('groups chats by agent and filters by query', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/app')],
      chatsByProject: {
        '/app': [
          _chat('c1', '/app', 'Fix button'),
          _chat('c2', '/app', 'Polish layout', agentId: 'opencode'),
        ],
      },
      settings: const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.agent,
      ),
      query: 'layout',
    );

    expect(sections.map((s) => s.title), contains('opencode'));
    expect(
      sections.expand((s) => s.entries).map((e) => e.chat?.chatId),
      contains('c2'),
    );
    expect(
      sections.expand((s) => s.entries).map((e) => e.chat?.chatId),
      isNot(contains('c1')),
    );
  });

  test('a query matching the project name keeps all of its chats', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/lucky_app'), _project('/other')],
      chatsByProject: {
        '/lucky_app': [
          _chat('c1', '/lucky_app', 'Chat 1'),
          _chat('c2', '/lucky_app', 'Chat 2'),
        ],
        '/other': [_chat('c3', '/other', 'Chat 3')],
      },
      settings: WorkspaceSidebarSettings.defaults,
      query: 'lucky',
    );

    final lucky = sections.singleWhere((s) => s.title == 'lucky_app');
    expect(
      lucky.entries.map((e) => e.chat?.chatId),
      containsAll(['c1', 'c2']),
    );
    expect(sections.map((s) => s.title), isNot(contains('other')));
  });

  test('separates pinned and unpinned entries', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/app')],
      chatsByProject: {
        '/app': [_chat('c1', '/app', 'Fix button')],
      },
      settings: const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.pinned,
        pinnedChatIds: {'c1'},
      ),
    );

    expect(sections.first.title, 'Pinned');
    // A pinned chat stays grouped under its own project's entry.
    expect(sections.first.entries.first.project?.projectRoot, '/app');
    expect(sections.first.entries.last.chat?.chatId, 'c1');
  });

  test('pinned chats stay scoped to their own project', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/test_app'), _project('/app_test')],
      chatsByProject: {
        '/test_app': [_chat('c2', '/test_app', 'Chat 2')],
        '/app_test': [
          _chat('c5', '/app_test', 'Chat 5'),
          _chat('c7', '/app_test', 'Chat 7'),
        ],
      },
      settings: const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.pinned,
        pinnedChatIds: {'c2', 'c5', 'c7'},
        pinnedProjectRoots: {'/app_test'},
      ),
    );

    final pinned = sections.first;
    final ids = pinned.entries.map((e) => e.id).toList();
    // Each chat follows its own project entry, never another project's.
    expect(ids, [
      'project:/test_app',
      'chat:c2',
      'project:/app_test',
      'chat:c5',
      'chat:c7',
    ]);
  });

  test('archived chats are hidden from every grouping', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/app')],
      chatsByProject: {
        '/app': [
          _chat('c1', '/app', 'Live chat'),
          _chat('c2', '/app', 'Old chat', status: ChatTaskStatus.archived),
        ],
      },
      settings: WorkspaceSidebarSettings.defaults,
    );

    final ids = sections.expand((s) => s.entries).map((e) => e.chat?.chatId);
    expect(ids, contains('c1'));
    expect(ids, isNot(contains('c2')));
  });

  test('groups chats by task status', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/app')],
      chatsByProject: {
        '/app': [
          _chat('c1', '/app', 'Fix button'),
          _chat(
            'c2',
            '/app',
            'Release pass',
            status: ChatTaskStatus.waiting,
          ),
        ],
      },
      settings: const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.status,
      ),
    );

    final waiting =
        sections.singleWhere((section) => section.title == 'Waiting');
    expect(waiting.entries.single.chat?.chatId, 'c2');
  });

  test('groups chats by labels and searches labels and briefs', () {
    final sections = buildWorkspaceSidebarSections(
      projects: [_project('/app')],
      chatsByProject: {
        '/app': [
          _chat(
            'c1',
            '/app',
            'Fix button',
            labels: ['release', 'ui'],
            brief: 'Toolbar polish',
          ),
          _chat('c2', '/app', 'Backend cleanup'),
        ],
      },
      settings: const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.label,
      ),
      query: 'release',
    );

    expect(sections.map((section) => section.title), contains('release'));
    expect(
      sections
          .expand((section) => section.entries)
          .map((entry) => entry.chat?.chatId),
      contains('c1'),
    );
    expect(
      sections
          .expand((section) => section.entries)
          .map((entry) => entry.chat?.chatId),
      isNot(contains('c2')),
    );
  });

  test('builds large sidebar sections within interactive budget', () {
    final projects = List.generate(
      100,
      (index) => _project('/workspace/project_$index'),
    );
    final chatsByProject = {
      for (final project in projects)
        project.projectRoot: List.generate(
          20,
          (index) => _chat(
            '${project.projectRoot}-$index',
            project.projectRoot,
            'Chat $index for ${project.displayName}',
            agentId: index.isEven ? 'codex' : 'opencode',
            skillId: index.isEven ? 'extract-widget' : 'fix-layout',
            lastActivityAt: DateTime(2026).add(Duration(minutes: index)),
          ),
        ),
    };
    final settingsCases = [
      WorkspaceSidebarSettings.defaults,
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.recentActivity,
      ),
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.pinned,
        pinnedProjectRoots: {'/workspace/project_1'},
        pinnedChatIds: {'/workspace/project_2-4'},
      ),
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.agent,
      ),
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.skill,
      ),
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.status,
      ),
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.label,
      ),
      const WorkspaceSidebarSettings(
        groupingMode: WorkspaceSidebarGroupingMode.custom,
        customChatGroups: {
          '/workspace/project_3-5': 'Review',
          '/workspace/project_4-6': 'Review',
        },
      ),
    ];

    final stopwatch = Stopwatch()..start();
    final sections = [
      for (final settings in settingsCases)
        buildWorkspaceSidebarSections(
          projects: projects,
          chatsByProject: chatsByProject,
          settings: settings,
          query: settings.groupingMode == WorkspaceSidebarGroupingMode.project
              ? 'project_99'
              : '',
        ),
    ];
    stopwatch.stop();

    expect(sections, hasLength(settingsCases.length));
    expect(sections.expand((section) => section), isNotEmpty);
    expect(stopwatch.elapsedMilliseconds, lessThan(500));
  });
}

ProjectRow _project(String root) => ProjectRow(
      projectRoot: root,
      displayName: root.split('/').last,
      createdAt: DateTime(2026),
      lastOpenedAt: DateTime(2026),
      sortOrder: 0,
    );

ChatRow _chat(
  String id,
  String project,
  String title, {
  String agentId = 'codex',
  String? skillId,
  ChatTaskStatus status = ChatTaskStatus.active,
  List<String> labels = const [],
  String? brief,
  DateTime? lastActivityAt,
}) =>
    ChatRow(
      chatId: id,
      projectRoot: project,
      title: title,
      agentId: agentId,
      skillId: skillId,
      status: status.name,
      labelsJson: encodeChatLabels(labels),
      taskBriefText: brief,
      createdAt: DateTime(2026),
      lastActivityAt: lastActivityAt ?? DateTime(2026),
      sortOrder: 0,
    );
