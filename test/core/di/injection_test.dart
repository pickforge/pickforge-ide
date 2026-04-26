import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/di/app_bootstrap.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    return getIt.reset();
  });

  test('configureDependencies registers AppBootstrap', () async {
    await configureDependencies();
    expect(getIt<AppBootstrap>().isReady, isTrue);
  });
}
