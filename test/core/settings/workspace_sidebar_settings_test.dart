import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('repository round-trips sidebar settings', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final repo = WorkspaceSidebarSettingsRepository(prefs);
    const settings = WorkspaceSidebarSettings(
      viewMode: WorkspaceSidebarViewMode.grid,
      groupingMode: WorkspaceSidebarGroupingMode.label,
      density: WorkspaceSidebarDensity.comfortable,
      pinnedProjectRoots: {'/app'},
      pinnedChatIds: {'chat-1'},
      collapsedGroupIds: {'label:Bug%20fixes'},
      customChatGroups: {'chat-1': 'Bug fixes'},
    );

    await repo.save(settings);

    expect(await repo.load(), settings);
  });

  test('repository returns defaults for invalid stored json', () async {
    SharedPreferences.setMockInitialValues({
      'workspace.sidebar.settings': '{',
    });
    final prefs = await SharedPreferences.getInstance();
    final repo = WorkspaceSidebarSettingsRepository(prefs);

    expect(await repo.load(), WorkspaceSidebarSettings.defaults);
  });
}
