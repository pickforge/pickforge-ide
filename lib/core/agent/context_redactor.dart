class ContextRedactor {
  const ContextRedactor();

  static final _assignmentPattern = RegExp(
    r'''(?<![\w])["']?([\w.-]*(?:api[_-]?key|secret|token|password)[\w.-]*)["']?\s*[:=]\s*["']?[^"'\s,;}]+["']?''',
    caseSensitive: false,
  );
  static final _privateKeyPattern = RegExp(
    r'-----BEGIN (RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----',
  );

  String redact(String input) {
    final withoutAssignments = input.replaceAllMapped(_assignmentPattern, (
      match,
    ) {
      final label = match.group(1) ?? 'secret';
      return '$label=[REDACTED]';
    });
    return withoutAssignments.replaceAll(
      _privateKeyPattern,
      '[REDACTED PRIVATE KEY]',
    );
  }
}
