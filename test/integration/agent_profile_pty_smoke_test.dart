import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/process/user_shell_environment.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/core/terminal/flutter_pty_adapter.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';

const _profiles = <AgentProfile>[
  ClaudeCodeProfile(),
  CodexProfile(),
  OpenCodeProfile(),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final smokeEnabled = Platform.environment['PICKFORGE_AGENT_PTY_SMOKE'] == '1';

  test(
    'installed agent profiles launch and receive Pickforge prompt over PTY',
    () async {
      final smoke = _AgentProfilePtySmoke(
        outDir: Directory(
          Platform.environment['PICKFORGE_AGENT_PTY_SMOKE_OUT_DIR'] ??
              'build/dogfood/agent-profile-pty',
        ),
        keepProject:
            Platform.environment['PICKFORGE_AGENT_PTY_SMOKE_KEEP_PROJECT'] ==
                '1',
      );

      final summary = await smoke.run();
      final encoded = const JsonEncoder.withIndent('  ').convert(summary);
      stdout.writeln(encoded);

      final results = summary['results']! as List<Map<String, Object?>>;
      final failures = results.where((result) => result['ok'] != true);
      expect(failures, isEmpty, reason: encoded);
    },
    skip: smokeEnabled
        ? false
        : 'Run scripts/agent_profile_pty_smoke.sh to enable this smoke.',
    timeout: const Timeout(Duration(minutes: 3)),
  );
}

class _AgentProfilePtySmoke {
  const _AgentProfilePtySmoke({
    required this.outDir,
    required this.keepProject,
  });

  final Directory outDir;
  final bool keepProject;

  Future<Map<String, Object?>> run() async {
    await outDir.create(recursive: true);
    final project = await Directory.systemTemp.createTemp(
      'pickforge-agent-profile-smoke-',
    );
    final results = <Map<String, Object?>>[];

    try {
      await _prepareProject(project);
      for (final profile in _profiles) {
        results.add(await _runProfile(profile, project));
      }
    } finally {
      if (keepProject) {
        stdout.writeln('Smoke project kept: ${project.path}');
      } else {
        await project.delete(recursive: true);
      }
    }

    final summary = <String, Object?>{
      'projectRoot': project.path,
      'results': results,
    };
    await File(p.join(outDir.path, 'summary.json')).writeAsString(
      const JsonEncoder.withIndent('  ').convert(summary),
    );
    return summary;
  }

  Future<Map<String, Object?>> _runProfile(
    AgentProfile profile,
    Directory project,
  ) async {
    final env = await UserShellEnvironment.instance.load();
    final detector = BinaryDetector(environmentLoader: () async => env);
    final invocation = profile.ptyArgsFor();
    final logPath = p.join(outDir.path, '${profile.id.value}.log');
    final log = File(logPath);
    await log.writeAsString('');

    if (!await detector.isBinaryOnPath(invocation.executable)) {
      await log.writeAsString('Binary not found: ${invocation.executable}\n');
      return {
        'agentId': profile.id.value,
        'displayName': profile.displayName,
        'binary': invocation.executable,
        'ok': false,
        'error': 'binary not found',
        'transcript': logPath,
      };
    }

    final prepared = await _launcher.prepareContext(
      ForgeRequest(
        widget: _selection(project.path),
        skill: SkillId.explainWidget,
        agentId: profile.id,
        terminalId: 'embedded',
        projectRoot: project.path,
        customNote: 'Installed-agent PTY smoke. Do not edit files.',
      ),
    );
    final contextFiles = await _copyContextArtifacts(profile, prepared);
    final token = 'PICKFORGE_AGENT_SMOKE_${profile.id.value}';
    final prompt = '${prepared.initialPrompt}\n\n'
        'Smoke check token: $token\n'
        'Reply with the token only if you process this; do not edit files.';

    final transcript = StringBuffer();
    final sink = log.openWrite(mode: FileMode.append);
    final session = PtySession(
      chatId: 'smoke-${profile.id.value}',
      executable: invocation.executable,
      arguments: invocation.arguments,
      workingDirectory: project.path,
      factory: FlutterPtyAdapter(),
      environment: env,
      onOutput: (bytes) {
        final text = const Utf8Decoder(allowMalformed: true).convert(bytes);
        transcript.write(text);
        sink.write(text);
      },
      spawnTimeout: const Duration(seconds: 15),
    );

    try {
      await session.start();
      if (session.currentState case PtyFailed(:final message)) {
        return {
          'agentId': profile.id.value,
          'displayName': profile.displayName,
          'binary': invocation.executable,
          'ok': false,
          'error': message,
          'transcript': logPath,
        };
      }
      if (session.currentState is! PtyRunning) {
        return {
          'agentId': profile.id.value,
          'displayName': profile.displayName,
          'binary': invocation.executable,
          'ok': false,
          'error': 'session did not reach running state',
          'transcript': logPath,
        };
      }

      session.sendPrompt(prompt);
      final delivered = await _waitFor(
        () {
          final value = transcript.toString();
          return value.contains('[Pickforge sent prompt]') &&
              value.contains(token);
        },
        timeout: const Duration(seconds: 8),
      );

      return {
        'agentId': profile.id.value,
        'displayName': profile.displayName,
        'binary': invocation.executable,
        'ok': delivered,
        'contextFiles': contextFiles,
        'transcript': logPath,
        if (!delivered) 'error': 'prompt marker not observed in transcript',
      };
    } finally {
      await session.dispose();
      await sink.flush();
      await sink.close();
    }
  }

  Future<Map<String, String>> _copyContextArtifacts(
    AgentProfile profile,
    PreparedContext prepared,
  ) async {
    final prefix = profile.id.value;
    final artifacts = {
      'skill': p.join(outDir.path, '$prefix-skill-active.md'),
      'widgetContext': p.join(outDir.path, '$prefix-widget-context.md'),
      'initialPrompt': p.join(outDir.path, '$prefix-initial-prompt.md'),
    };
    await File(prepared.written.skillPath).copy(artifacts['skill']!);
    await File(prepared.written.widgetContextPath).copy(
      artifacts['widgetContext']!,
    );
    await File(prepared.written.initialPromptPath).copy(
      artifacts['initialPrompt']!,
    );
    return artifacts;
  }
}

Future<bool> _waitFor(
  bool Function() predicate, {
  required Duration timeout,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (predicate()) return true;
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  return predicate();
}

Future<void> _prepareProject(Directory project) async {
  await Directory(p.join(project.path, 'lib')).create(recursive: true);
  await File(p.join(project.path, 'lib', 'main.dart')).writeAsString('''
import 'package:flutter/material.dart';

class SmokeButton extends StatelessWidget {
  const SmokeButton({super.key});

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(onPressed: () {}, child: const Text('Smoke'));
  }
}
''');
  await Directory(p.join(project.path, '.pickforge', 'skills'))
      .create(recursive: true);
  await Directory(p.join(project.path, '.pickforge', 'prompt-templates'))
      .create(recursive: true);
  await File(p.join(project.path, '.pickforge', '.gitignore'))
      .writeAsString('*\n');
  await File(
    p.join(project.path, '.pickforge', 'skills', 'explain-widget.md'),
  ).writeAsString(
    '# Smoke skill\n\n'
    'Read the selected widget context and do not edit files.\n',
  );

  for (final profile in _profiles) {
    await File(
      p.join(
        project.path,
        '.pickforge',
        'prompt-templates',
        '${profile.id.value}-explain-widget.md.tmpl',
      ),
    ).writeAsString('''
{{read_files_bullets}}

This is a Pickforge installed-agent PTY smoke. Do not edit files.
''');
  }
}

AgentLauncher get _launcher => AgentLauncher(
      agentRegistry: AgentProfileRegistry(_profiles),
      contextWriter: PickforgeContextWriter(),
      skillStore: SkillStore(),
      widgetRenderer: const WidgetContextRenderer(),
    );

SelectedWidget _selection(String projectRoot) => SelectedWidget(
      node: WidgetNode(
        id: 'smoke-button',
        className: 'SmokeButton',
        children: const [],
        creationLocation: CreationLocation(
          file: p.join(projectRoot, 'lib', 'main.dart'),
          line: 7,
          column: 12,
        ),
      ),
      ancestorClasses: const ['MaterialApp', 'Scaffold'],
      sourceSnippet:
          "ElevatedButton(onPressed: () {}, child: const Text('Smoke'))",
      screenshotPath: null,
      adbScreenshotPath: null,
      propertiesJson: const {},
    );
