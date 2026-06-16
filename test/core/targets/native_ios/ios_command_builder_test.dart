import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/native_ios/ios_command_builder.dart';
import 'package:pickforge/core/targets/native_ios/ios_project_detector.dart';

void main() {
  const builder = IosCommandBuilder();
  const projectOnly =
      IosProjectInfo(projectRoot: '/app', xcodeproj: 'Demo.xcodeproj');
  const withWorkspace = IosProjectInfo(
    projectRoot: '/app',
    workspace: 'Demo.xcworkspace',
    xcodeproj: 'Demo.xcodeproj',
  );

  group('xcodebuild', () {
    test('builds with -project and the scheme + destination', () {
      final command = builder.build(project: projectOnly, scheme: 'Demo');
      expect(command.executable, 'xcodebuild');
      expect(command.arguments, [
        '-project',
        'Demo.xcodeproj',
        '-scheme',
        'Demo',
        '-destination',
        'platform=iOS Simulator,name=iPhone 15',
        'build',
      ]);
      expect(command.cwd, '/app');
    });

    test('prefers -workspace when a workspace is present', () {
      final command = builder.build(
        project: withWorkspace,
        scheme: 'Demo',
        destination: 'id=ABC-123',
      );
      expect(command.arguments.take(2), ['-workspace', 'Demo.xcworkspace']);
      expect(command.arguments.contains('-project'), isFalse);
      expect(command.arguments, contains('id=ABC-123'));
    });

    test('lists schemes as JSON', () {
      final command = builder.listSchemes(project: projectOnly);
      expect(command.arguments, [
        '-project',
        'Demo.xcodeproj',
        '-list',
        '-json',
      ]);
    });

    test('lists schemes for a workspace', () {
      final command = builder.listSchemes(project: withWorkspace);
      expect(command.arguments, [
        '-workspace',
        'Demo.xcworkspace',
        '-list',
        '-json',
      ]);
      expect(command.arguments.contains('-project'), isFalse);
      expect(command.cwd, '/app');
    });
  });

  group('simctl', () {
    test('list / boot / install / launch / screenshot / log', () {
      expect(
        builder.simctlListDevices().arguments,
        ['simctl', 'list', 'devices', 'available', '--json'],
      );
      expect(builder.simctlBoot('UD').arguments, ['simctl', 'boot', 'UD']);
      expect(
        builder.simctlInstall('UD', '/a.app').arguments,
        ['simctl', 'install', 'UD', '/a.app'],
      );
      expect(
        builder.simctlLaunch('UD', 'com.demo').arguments,
        ['simctl', 'launch', 'UD', 'com.demo'],
      );
      expect(
        builder.simctlScreenshot('UD', '/s.png').arguments,
        ['simctl', 'io', 'UD', 'screenshot', '/s.png'],
      );
      expect(
        builder.simctlLogStream('UD').arguments,
        ['simctl', 'spawn', 'UD', 'log', 'stream', '--style', 'compact'],
      );
      // simctl commands are project-independent.
      expect(builder.simctlBoot('UD').cwd, isNull);
    });
  });
}
