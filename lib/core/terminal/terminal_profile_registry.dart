import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

@lazySingleton
class TerminalProfileRegistry {
  TerminalProfileRegistry(this._profiles);
  final List<TerminalProfile> _profiles;

  TerminalProfile? get(String id) {
    for (final p in _profiles) {
      if (p.id == id) return p;
    }
    return null;
  }

  List<TerminalProfile> availableOnThisOs() {
    final current = currentOs;
    return _profiles.where((p) => p.supportedPlatforms.contains(current)).toList();
  }
}
