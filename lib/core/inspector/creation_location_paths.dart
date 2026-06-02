String? creationLocationFilePath(String file) {
  final value = file.trim();
  if (value.isEmpty) return null;
  if (RegExp(r'^[A-Za-z]:[\\/]').hasMatch(value)) return value;

  final uri = Uri.tryParse(value);
  if (uri != null && uri.hasScheme) {
    if (uri.scheme == 'file') {
      return uri.toFilePath();
    }
    return null;
  }

  return value;
}
