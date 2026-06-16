import 'dart:convert';

import 'package:path/path.dart' as p;

class ProjectId {
  const ProjectId._();

  static String forRoot(String projectRoot, {String? repoRemoteUrl}) {
    final canonical = p.canonicalize(projectRoot);
    final remote = repoRemoteUrl?.trim();
    final basis = (remote != null && remote.isNotEmpty)
        ? '$canonical $remote'
        : canonical;
    final hash = _stableHash(basis);
    final slug = _slug(p.basename(canonical));
    return slug.isEmpty ? hash : '$slug-$hash';
  }

  static String _slug(String input) {
    return input
        .toLowerCase()
        .replaceAll(RegExp('[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
  }

  static String _stableHash(String input) {
    // Desktop-only app; the FNV-1a 64-bit basis is intentionally a full 64-bit
    // literal and is never compiled to JavaScript.
    // ignore: avoid_js_rounded_ints
    const offsetBasis = 0xcbf29ce484222325;
    const prime = 0x100000001b3;
    const mask = 0xFFFFFFFFFFFFFFFF;
    var hash = offsetBasis;
    for (final byte in utf8.encode(input)) {
      hash ^= byte;
      hash = (hash * prime) & mask;
    }
    final high = (hash >>> 32) & 0xFFFFFFFF;
    final low = hash & 0xFFFFFFFF;
    return high.toRadixString(16).padLeft(8, '0') +
        low.toRadixString(16).padLeft(8, '0');
  }
}
