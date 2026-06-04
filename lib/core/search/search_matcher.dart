class SearchMatcher {
  const SearchMatcher._();

  static bool matches(String query, Iterable<String?> fields) {
    final tokens = _tokens(query);
    if (tokens.isEmpty) return false;
    return tokens.every(
      (token) => fields.any((field) => _matchesToken(token, field ?? '')),
    );
  }

  static bool _matchesToken(String token, String value) {
    final normalized = value.toLowerCase();
    return normalized.contains(token) || _isSubsequence(token, normalized);
  }

  static bool _isSubsequence(String needle, String value) {
    var index = 0;
    for (final codeUnit in value.codeUnits) {
      if (index < needle.length && codeUnit == needle.codeUnitAt(index)) {
        index++;
      }
    }
    return index == needle.length;
  }

  static List<String> _tokens(String value) => value
      .toLowerCase()
      .trim()
      .split(RegExp(r'\s+'))
      .where((token) => token.isNotEmpty)
      .toList(growable: false);
}
