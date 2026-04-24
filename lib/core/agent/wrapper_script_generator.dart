/// Generates wrapper scripts for invoking agent binaries with
/// Pickforge context.
///
/// Pure utility — no DI needed.
class WrapperScriptGenerator {
  const WrapperScriptGenerator();

  /// Generates a Unix/bash wrapper script.
  ///
  /// Pattern: multi-line bash with single-quoted variables.
  String unix({
    required String projectRoot,
    required String agentBinary,
    required List<String> args,
    required String promptPath,
  }) {
    final argsStr = args.map((a) => "'$a'").join(' ');
    return '''
#!/usr/bin/env bash
set -euo pipefail
cd '$projectRoot'
$agentBinary $argsStr < '$promptPath'
''';
  }

  /// Generates a Windows batch wrapper script.
  ///
  /// Pattern: multi-line batch with double-quoted variables.
  String windows({
    required String projectRoot,
    required String agentBinary,
    required List<String> args,
    required String promptPath,
  }) {
    final argsStr = args.join(' ');
    return '''
@echo off
cd /d "$projectRoot"
type "$promptPath" | $agentBinary $argsStr
''';
  }
}
