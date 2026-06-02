import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';

SelectedWidget _widget(String? file) {
  return SelectedWidget(
    node: WidgetNode(
      id: 'w1',
      className: 'Text',
      children: const [],
      creationLocation: file == null
          ? null
          : CreationLocation(file: file, line: 1, column: 1),
    ),
    ancestorClasses: const [],
    sourceSnippet: null,
    screenshotPath: null,
    adbScreenshotPath: null,
    propertiesJson: const {},
  );
}

void main() {
  const policy = ForgeEligibilityPolicy();

  test('allows absolute user code under project lib directory', () {
    expect(
      policy.canForge(
        _widget('/workspace/app/lib/main.dart'),
        '/workspace/app',
      ),
      isTrue,
    );
  });

  test('allows relative user code under project lib directory', () {
    expect(policy.canForge(_widget('lib/main.dart'), '/workspace/app'), isTrue);
  });

  test('allows file URI user code under project lib directory', () {
    expect(
      policy.canForge(
        _widget('file:///workspace/app/lib/main.dart'),
        '/workspace/app',
      ),
      isTrue,
    );
  });

  test('rejects widgets without creation location', () {
    expect(policy.canForge(_widget(null), '/workspace/app'), isFalse);
  });

  test('rejects Flutter framework paths', () {
    expect(
      policy.canForge(
        _widget('/opt/flutter/packages/flutter/lib/src/widgets/text.dart'),
        '/workspace/app',
      ),
      isFalse,
    );
  });

  test('rejects files outside the active project', () {
    expect(
      policy.canForge(
        _widget('/workspace/other/lib/main.dart'),
        '/workspace/app',
      ),
      isFalse,
    );
  });

  test('rejects files outside the default allowlist', () {
    expect(
      policy.canForge(_widget('test/widget_test.dart'), '/workspace/app'),
      isFalse,
    );
  });

  test('supports allowlist overrides', () {
    const packagePolicy = ForgeEligibilityPolicy(
      allowedRootRelativePrefixes: ['packages/design/lib/'],
    );

    expect(
      packagePolicy.canForge(
        _widget('packages/design/lib/button.dart'),
        '/workspace/app',
      ),
      isTrue,
    );
  });
}
