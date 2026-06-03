import 'package:flutter_test/flutter_test.dart';
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
    expect(sections.first.entries.single.chat?.chatId, 'c1');
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
}) =>
    ChatRow(
      chatId: id,
      projectRoot: project,
      title: title,
      agentId: agentId,
      createdAt: DateTime(2026),
      lastActivityAt: DateTime(2026),
      sortOrder: 0,
    );
