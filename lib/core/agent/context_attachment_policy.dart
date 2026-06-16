import 'package:path/path.dart' as p;

class ContextAttachmentPolicy {
  const ContextAttachmentPolicy();

  static const blockedBasenames = {
    '.env',
    '.npmrc',
    '.pypirc',
    '.netrc',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
  };

  static const blockedExtensions = {
    '.a',
    '.apk',
    '.app',
    '.class',
    '.dll',
    '.dylib',
    '.exe',
    '.gif',
    '.ico',
    '.jar',
    '.jpeg',
    '.jpg',
    '.jks',
    '.key',
    '.keystore',
    '.o',
    '.pdf',
    '.pem',
    '.png',
    '.p12',
    '.so',
    '.webp',
    '.zip',
  };

  /// Returns a reason string when [relativePath] (relative to the project root)
  /// must not be attached, else null.
  ///
  /// Project-local context is rejected via the legacy `.pickforge/` prefix.
  /// In home/custom storage modes the context dir lives outside the project,
  /// so pass [projectRoot] + [contextDir] to also reject anything resolving
  /// under the active context dir.
  String? blockedReason(
    String relativePath, {
    String? projectRoot,
    String? contextDir,
  }) {
    final normalized = relativePath.replaceAll(r'\', '/');
    final basename = p.basename(normalized).toLowerCase();
    if (blockedBasenames.contains(basename) || basename.startsWith('.env.')) {
      return 'blocked: likely secret file';
    }
    final extension = p.extension(basename);
    if (blockedExtensions.contains(extension)) {
      return 'blocked: binary or sensitive file type';
    }
    if (normalized.startsWith('.pickforge/')) {
      return 'blocked: Pickforge local context';
    }
    if (projectRoot != null && contextDir != null) {
      final absolute = p.normalize(p.join(projectRoot, normalized));
      final normalizedContext = p.normalize(contextDir);
      if (absolute == normalizedContext ||
          p.isWithin(normalizedContext, absolute)) {
        return 'blocked: Pickforge local context';
      }
    }
    return null;
  }
}
