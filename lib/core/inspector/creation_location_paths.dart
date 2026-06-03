String? creationLocationFilePath(String file) {
  final value = file.trim();
  if (value.isEmpty) return null;
  if (RegExp(r'^[A-Za-z]:[\\/]').hasMatch(value)) return value;

  final uri = Uri.tryParse(value);
  if (uri != null && uri.hasScheme) {
    if (uri.scheme == 'file') {
      return uri.toFilePath();
    }
    if (uri.scheme == 'org-dartlang-app') {
      return _relativeUriPath(uri);
    }
    return null;
  }

  return value;
}

String? _relativeUriPath(Uri uri) {
  final path = uri.path.replaceFirst(RegExp('^/+'), '');
  return path.isEmpty ? null : path;
}
