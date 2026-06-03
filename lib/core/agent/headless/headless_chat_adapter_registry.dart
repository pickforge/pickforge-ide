import 'package:pickforge/core/agent/headless/headless_chat_adapter.dart';
import 'package:pickforge/core/agent/models.dart';

class HeadlessChatAdapterRegistry {
  HeadlessChatAdapterRegistry(Iterable<HeadlessChatAdapter> adapters)
      : _byId = {
          for (final adapter in adapters) adapter.agentId: adapter,
        };

  final Map<AgentProfileId, HeadlessChatAdapter> _byId;

  HeadlessChatAdapter get(AgentProfileId agentId) {
    final adapter = _byId[agentId];
    if (adapter == null) {
      throw StateError('No headless chat adapter for ${agentId.value}.');
    }
    return adapter;
  }

  bool supports(AgentProfileId agentId) => _byId.containsKey(agentId);

  Iterable<HeadlessChatAdapter> all() => _byId.values;
}
