import 'package:injectable/injectable.dart';

@lazySingleton
class AppBootstrap {
  bool get isReady => true;
}
