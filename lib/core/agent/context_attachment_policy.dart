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

  String? blockedReason(String relativePath) {
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
    return null;
  }
}
