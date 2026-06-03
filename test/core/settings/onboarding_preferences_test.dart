import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/settings/onboarding_preferences.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('stores dismissed state', () async {
    final prefs = await SharedPreferences.getInstance();
    final onboarding = OnboardingPreferences(prefs);

    expect(onboarding.isDismissed, isFalse);

    await onboarding.setDismissed(value: true);
    expect(onboarding.isDismissed, isTrue);

    await onboarding.setDismissed(value: false);
    expect(onboarding.isDismissed, isFalse);
  });
}
