import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/agent_profile.dart';
import 'package:pickforge/core/agent/models.dart';

@lazySingleton
class AgentProfileRegistry {
  AgentProfileRegistry(this._profiles);
  final List<AgentProfile> _profiles;

  AgentProfile get(AgentProfileId id) => _profiles.firstWhere(
        (p) => p.id == id,
        orElse: () => throw StateError('No AgentProfile registered for $id'),
      );

  List<AgentProfile> all() => List.unmodifiable(_profiles);
}
