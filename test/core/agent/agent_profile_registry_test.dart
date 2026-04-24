import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';

class _FakeProfile extends AgentProfile {
  const _FakeProfile(this._id);
  final AgentProfileId _id;

  @override
  AgentProfileId get id => _id;

  @override
  String get displayName => 'Fake';

  @override
  String get binary => 'fake';

  @override
  String get projectContextFile => 'fake.md';

  @override
  List<String> invocationArgs() => [];

  @override
  String buildInitialPrompt({
    required String pickforgeDirRelative,
    required String skillFilename,
    required String widgetContextFilename,
    required String? screenshotFilename,
    required String? deviceScreenFilename,
  }) =>
      '';
}

void main() {
  group('AgentProfileRegistry', () {
    test('returns registered profile by id', () {
      const profile = _FakeProfile(AgentProfileId.claudeCode);
      final registry = AgentProfileRegistry([profile]);

      expect(registry.get(AgentProfileId.claudeCode), profile);
    });

    test('throws StateError for unknown id', () {
      const profile = _FakeProfile(AgentProfileId.claudeCode);
      final registry = AgentProfileRegistry([profile]);

      expect(
        () => registry.get(AgentProfileId.codex),
        throwsA(isA<StateError>()),
      );
    });

    test('all() returns unmodifiable list', () {
      const p1 = _FakeProfile(AgentProfileId.claudeCode);
      const p2 = _FakeProfile(AgentProfileId.codex);
      final registry = AgentProfileRegistry([p1, p2]);

      final all = registry.all();
      expect(all, hasLength(2));
      expect(all, contains(p1));
      expect(all, contains(p2));
      expect(() => (all as List).add(_FakeProfile(AgentProfileId.opencode)),
          throwsA(isA<UnsupportedError>()));
    });
  });
}
