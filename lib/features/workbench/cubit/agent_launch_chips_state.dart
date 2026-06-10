import 'package:equatable/equatable.dart';
import 'package:pickforge/core/agent/models.dart';

class AgentLaunchChip extends Equatable {
  const AgentLaunchChip({
    required this.id,
    required this.label,
    required this.command,
    required this.available,
    required this.emphasized,
    required this.binary,
  });

  final AgentProfileId id;
  final String label;
  final String command;
  final bool available;
  final bool emphasized;
  final String binary;

  @override
  List<Object?> get props => [id, label, command, available, emphasized];
}

class AgentLaunchChipsState extends Equatable {
  const AgentLaunchChipsState({this.chips = const [], this.loaded = false});

  final List<AgentLaunchChip> chips;
  final bool loaded;

  @override
  List<Object?> get props => [chips, loaded];
}
