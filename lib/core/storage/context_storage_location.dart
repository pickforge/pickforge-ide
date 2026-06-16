import 'package:equatable/equatable.dart';

enum ContextStorageMode { pickforgeHome, projectLocal, customPath }

class ContextStorageLocation extends Equatable {
  const ContextStorageLocation._(this.mode, this.customPath);

  const ContextStorageLocation.pickforgeHome()
      : this._(ContextStorageMode.pickforgeHome, null);

  const ContextStorageLocation.projectLocal()
      : this._(ContextStorageMode.projectLocal, null);

  const ContextStorageLocation.custom(String path)
      : this._(ContextStorageMode.customPath, path);

  final ContextStorageMode mode;
  final String? customPath;

  String get wireName {
    switch (mode) {
      case ContextStorageMode.pickforgeHome:
        return 'home';
      case ContextStorageMode.projectLocal:
        return 'project-local';
      case ContextStorageMode.customPath:
        return 'custom';
    }
  }

  static ContextStorageLocation? fromWire(String? wire, {String? customPath}) {
    switch (wire) {
      case 'home':
        return const ContextStorageLocation.pickforgeHome();
      case 'project-local':
        return const ContextStorageLocation.projectLocal();
      case 'custom':
        if (customPath == null) {
          return null;
        }
        return ContextStorageLocation.custom(customPath);
      default:
        return null;
    }
  }

  @override
  List<Object?> get props => [mode, customPath];
}
