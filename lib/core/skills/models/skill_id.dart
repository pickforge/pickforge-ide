enum SkillId {
  editWidget('edit-widget'),
  extractWidget('extract-widget'),
  explainWidget('explain-widget');

  const SkillId(this.value);
  final String value;

  static SkillId fromValue(String raw) =>
      SkillId.values.firstWhere((e) => e.value == raw);
}
