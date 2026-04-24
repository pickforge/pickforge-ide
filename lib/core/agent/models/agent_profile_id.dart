enum AgentProfileId {
  claudeCode('claude-code'),
  codex('codex'),
  opencode('opencode');

  const AgentProfileId(this.value);
  final String value;

  static AgentProfileId fromValue(String raw) =>
      AgentProfileId.values.firstWhere((e) => e.value == raw);
}
