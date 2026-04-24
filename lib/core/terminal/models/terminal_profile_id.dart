enum TerminalProfileId {
  ghostty('ghostty'),
  iterm2('iterm2'),
  warp('warp'),
  wezterm('wezterm'),
  alacritty('alacritty'),
  kitty('kitty'),
  windowsTerminal('windows-terminal'),
  gnomeTerminal('gnome-terminal'),
  terminalApp('terminal-app'),
  envFallback('env-fallback');

  const TerminalProfileId(this.value);
  final String value;

  static TerminalProfileId fromValue(String raw) =>
      TerminalProfileId.values.firstWhere((e) => e.value == raw);
}
