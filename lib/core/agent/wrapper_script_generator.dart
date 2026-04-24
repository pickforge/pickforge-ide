/// Generates wrapper scripts for invoking agent binaries with
/// Pickforge context.
///
/// Pure utility — no DI needed.
class WrapperScriptGenerator {
  const WrapperScriptGenerator();

  /// Generates a Unix/bash wrapper script.
  ///
  /// Pattern: `cd projectRoot && agentBinary args < promptPath`
  String unix({
    required String projectRoot,
    required String agentBinary,
    required List<String> args,
    required String promptPath,
  }) {
    final argsStr = args.isEmpty ? '' : ' ${args.join(' ')}';
    return 'cd $projectRoot && $agentBinary$argsStr < $promptPath';
  }

  /// Generates a Windows batch wrapper script.
  ///
  /// Pattern: `cd /d projectRoot && type promptPath | agentBinary args`
  String windows({
    required String projectRoot,
    required String agentBinary,
    required List<String> args,
    required String promptPath,
  }) {
    final argsStr = args.isEmpty ? '' : ' ${args.join(' ')}';
    return 'cd /d $projectRoot && type $promptPath | $agentBinary$argsStr';
  }
}
