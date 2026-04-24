import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models.dart';

void main() {
  test('ForgeRequest round-trips through JSON', () {
    const req = ForgeRequest(
      widget: SelectedWidget(
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
        propertiesJson: <String, dynamic>{'key': 'value'},
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
