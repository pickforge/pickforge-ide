Map<String, String> normalizePtyEnvironment(Map<String, String> environment) {
  final normalized = Map<String, String>.from(environment)
    ..remove('NO_COLOR')
    ..remove('ANSI_COLORS_DISABLED')
    ..['TERM'] = 'xterm-256color'
    ..['COLORTERM'] = 'truecolor'
    ..['CLICOLOR'] = '1';

  return normalized;
}
