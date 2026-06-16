class PromptTemplateVariables {
  const PromptTemplateVariables({
    required this.agentId,
    required this.skillId,
    required this.projectContextFile,
    required this.pickforgeContextDir,
    required this.skillFilename,
    required this.widgetContextFilename,
    required this.screenshotFilename,
    required this.deviceScreenFilename,
  });

  final String agentId;
  final String skillId;
  final String projectContextFile;
  final String pickforgeContextDir;
  final String skillFilename;
  final String widgetContextFilename;
  final String? screenshotFilename;
  final String? deviceScreenFilename;

  String get skillPath => _relativePath(skillFilename);
  String get widgetContextPath => _relativePath(widgetContextFilename);
  String get screenshotPath =>
      screenshotFilename == null ? '' : _relativePath(screenshotFilename!);
  String get deviceScreenPath =>
      deviceScreenFilename == null ? '' : _relativePath(deviceScreenFilename!);

  Map<String, String> get placeholders => {
        'agent_id': agentId,
        'skill_id': skillId,
        'project_context_file': projectContextFile,
        'pickforge_dir': pickforgeContextDir,
        'skill_file': skillFilename,
        'skill_path': skillPath,
        'widget_context_file': widgetContextFilename,
        'widget_context_path': widgetContextPath,
        'screenshot_file': screenshotFilename ?? '',
        'screenshot_path': screenshotPath,
        'device_screen_file': deviceScreenFilename ?? '',
        'device_screen_path': deviceScreenPath,
        'read_files_bullets': _readFilesBullets,
        'read_files_numbered': _readFilesNumbered,
        'optional_files_bullets': _optionalFilesBullets,
        'optional_files_numbered': _optionalFilesNumbered,
      };

  List<String> get _readFilePaths => [
        skillPath,
        widgetContextPath,
        if (screenshotFilename != null) screenshotPath,
        if (deviceScreenFilename != null) deviceScreenPath,
      ];

  List<String> get _optionalFilePaths => [
        if (screenshotFilename != null) screenshotPath,
        if (deviceScreenFilename != null) deviceScreenPath,
      ];

  String get _readFilesBullets =>
      _readFilePaths.map((path) => '- Read $path').join('\n');

  String get _readFilesNumbered => _readFilePaths
      .asMap()
      .entries
      .map((entry) => '${entry.key + 1}. Read ${entry.value}')
      .join('\n');

  String get _optionalFilesBullets =>
      _optionalFilePaths.map((path) => '- Read $path').join('\n');

  String get _optionalFilesNumbered => _optionalFilePaths
      .asMap()
      .entries
      .map((entry) => '${entry.key + 1}. Read ${entry.value}')
      .join('\n');

  String _relativePath(String filename) =>
      pickforgeContextDir.isEmpty ? filename : '$pickforgeContextDir/$filename';
}

class PromptTemplateRenderer {
  const PromptTemplateRenderer();

  String render(String template, PromptTemplateVariables variables) {
    var rendered = template;
    for (final entry in variables.placeholders.entries) {
      rendered = rendered.replaceAll('{{${entry.key}}}', entry.value);
    }
    return rendered.replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
  }
}
