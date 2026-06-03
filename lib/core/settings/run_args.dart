import 'package:freezed_annotation/freezed_annotation.dart';

part 'run_args.freezed.dart';

@freezed
abstract class RunArgs with _$RunArgs {
  const factory RunArgs({
    String? targetFile,
    @Default(<String>[]) List<String> extraArgs,
  }) = _RunArgs;
}

enum FlutterBuildMode {
  debug,
  profile,
  release;

  String get label => switch (this) {
        FlutterBuildMode.debug => 'Debug',
        FlutterBuildMode.profile => 'Profile',
        FlutterBuildMode.release => 'Release',
      };

  String? get flag => switch (this) {
        FlutterBuildMode.debug => null,
        FlutterBuildMode.profile => '--profile',
        FlutterBuildMode.release => '--release',
      };
}

class ParsedRunArgs {
  const ParsedRunArgs({
    required this.buildMode,
    required this.flavor,
    required this.manualExtraArgs,
  });

  final FlutterBuildMode buildMode;
  final String? flavor;
  final List<String> manualExtraArgs;
}

extension RunArgsEditing on RunArgs {
  ParsedRunArgs get parsed {
    var buildMode = FlutterBuildMode.debug;
    String? flavor;
    final manual = <String>[];
    for (var i = 0; i < extraArgs.length; i++) {
      final arg = extraArgs[i];
      final parsedMode = _modeForFlag(arg);
      if (parsedMode != null) {
        buildMode = parsedMode;
        continue;
      }
      if (arg == '--flavor') {
        if (i + 1 < extraArgs.length) {
          flavor = extraArgs[++i];
        } else {
          manual.add(arg);
        }
        continue;
      }
      if (arg.startsWith('--flavor=')) {
        flavor = arg.substring('--flavor='.length);
        continue;
      }
      manual.add(arg);
    }
    return ParsedRunArgs(
      buildMode: buildMode,
      flavor: flavor,
      manualExtraArgs: manual,
    );
  }

  RunArgs withTargetFile(String? targetFile) {
    final value = targetFile?.trim();
    return copyWith(targetFile: value == null || value.isEmpty ? null : value);
  }

  RunArgs withBuildMode(FlutterBuildMode mode) {
    final parsedArgs = parsed;
    return copyWith(
      extraArgs: _composeExtraArgs(
        buildMode: mode,
        flavor: parsedArgs.flavor,
        manualExtraArgs: parsedArgs.manualExtraArgs,
      ),
    );
  }

  RunArgs withFlavor(String? flavor) {
    final parsedArgs = parsed;
    final value = flavor?.trim();
    return copyWith(
      extraArgs: _composeExtraArgs(
        buildMode: parsedArgs.buildMode,
        flavor: value == null || value.isEmpty ? null : value,
        manualExtraArgs: parsedArgs.manualExtraArgs,
      ),
    );
  }

  RunArgs withManualExtraArgs(List<String> manualExtraArgs) {
    final parsedArgs = parsed;
    return copyWith(
      extraArgs: _composeExtraArgs(
        buildMode: parsedArgs.buildMode,
        flavor: parsedArgs.flavor,
        manualExtraArgs: manualExtraArgs,
      ),
    );
  }
}

List<String> parseExtraArgsText(String value) {
  final args = <String>[];
  final buffer = StringBuffer();
  String? quote;
  var escaping = false;

  void flush() {
    if (buffer.isEmpty) return;
    args.add(buffer.toString());
    buffer.clear();
  }

  for (final codePoint in value.runes) {
    final char = String.fromCharCode(codePoint);
    if (escaping) {
      buffer.write(char);
      escaping = false;
      continue;
    }
    if (char == r'\') {
      escaping = true;
      continue;
    }
    if (quote != null) {
      if (char == quote) {
        quote = null;
      } else {
        buffer.write(char);
      }
      continue;
    }
    if (char == '"' || char == "'") {
      quote = char;
      continue;
    }
    if (char.trim().isEmpty) {
      flush();
      continue;
    }
    buffer.write(char);
  }
  if (escaping) buffer.write(r'\');
  flush();
  return args;
}

String formatExtraArgsText(List<String> args) {
  return args.map(_formatExtraArg).join(' ');
}

FlutterBuildMode? _modeForFlag(String arg) => switch (arg) {
      '--profile' => FlutterBuildMode.profile,
      '--release' => FlutterBuildMode.release,
      '--debug' => FlutterBuildMode.debug,
      _ => null,
    };

List<String> _composeExtraArgs({
  required FlutterBuildMode buildMode,
  required String? flavor,
  required List<String> manualExtraArgs,
}) {
  return [
    if (buildMode.flag != null) buildMode.flag!,
    if (flavor != null && flavor.isNotEmpty) ...['--flavor', flavor],
    ...manualExtraArgs,
  ];
}

String _formatExtraArg(String arg) {
  if (arg.isEmpty) return '""';
  if (!arg.contains(RegExp(r'\s|["\\]'))) return arg;
  return '"${arg.replaceAll(r'\', r'\\').replaceAll('"', r'\"')}"';
}
