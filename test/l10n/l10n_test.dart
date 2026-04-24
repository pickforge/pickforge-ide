import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

void main() {
  testWidgets('AppLocalizations loads English strings', (tester) async {
    await tester.pumpWidget(
      Localizations(
        locale: const Locale('en'),
        delegates: AppLocalizations.localizationsDelegates,
        child: Builder(
          builder: (ctx) {
            final l10n = AppLocalizations.of(ctx);
            expect(l10n.appName, 'Pickforge');
            expect(l10n.forgeItButton, 'Forge it');
            return const SizedBox();
          },
        ),
      ),
    );
  });
}
