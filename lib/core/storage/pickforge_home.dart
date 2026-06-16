import 'dart:io';

import 'package:path/path.dart' as p;

class PickforgeHome {
  const PickforgeHome._();

  static String resolve({Map<String, String>? environment, bool? isWindows}) {
    final env = environment ?? Platform.environment;
    final windows = isWindows ?? Platform.isWindows;

    final override = env['PICKFORGE_HOME']?.trim();
    if (override != null && override.isNotEmpty) {
      return override;
    }

    if (windows) {
      final userProfile = env['USERPROFILE']?.trim();
      final base = (userProfile != null && userProfile.isNotEmpty)
          ? userProfile
          : p.join(env['HOMEDRIVE'] ?? '', env['HOMEPATH'] ?? '');
      return p.join(base, '.pickforge');
    }

    final home = env['HOME']?.trim();
    if (home == null || home.isEmpty) {
      throw const PickforgeHomeUnavailableException();
    }
    return p.join(home, '.pickforge');
  }
}

class PickforgeHomeUnavailableException implements Exception {
  const PickforgeHomeUnavailableException();

  @override
  String toString() =>
      'PickforgeHomeUnavailableException: HOME is not set; cannot resolve '
      'the PickForge home directory.';
}
