import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/components/components.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

import '../support/golden_test_harness.dart';

void main() {
  setUpAll(loadGoldenFonts);

  testWidgets(
    'component gallery matches golden',
    (tester) async {
      const key = ValueKey('component-gallery-golden');

      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        size: const Size(900, 760),
        child: const _Gallery(),
      );

      await expectGolden(key, 'component_gallery');
    },
    skip: skipGoldenPlatform,
  );
}

class _Gallery extends StatelessWidget {
  const _Gallery();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(PickforgeSpacing.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MonoEyebrow('Design System', tick: true),
          const SizedBox(height: PickforgeSpacing.sm),
          Text(
            'PickForge components',
            style: Theme.of(context).textTheme.displaySmall,
          ),
          const SizedBox(height: PickforgeSpacing.xl),
          Wrap(
            spacing: PickforgeSpacing.md,
            runSpacing: PickforgeSpacing.md,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              EmberButton(
                label: 'Forge it',
                icon: Icons.auto_fix_high,
                onPressed: () {},
              ),
              FilledButton(onPressed: () {}, child: const Text('Primary')),
              OutlinedButton(onPressed: () {}, child: const Text('Secondary')),
            ],
          ),
          const SizedBox(height: PickforgeSpacing.lg),
          const Wrap(
            spacing: PickforgeSpacing.sm,
            runSpacing: PickforgeSpacing.sm,
            children: [
              StatusPill(label: 'Live', intent: StatusIntent.live),
              StatusPill(label: 'Connected', intent: StatusIntent.connected),
              StatusPill(label: 'Booting', intent: StatusIntent.warning),
              StatusPill(label: 'Error', intent: StatusIntent.error),
              StatusPill(label: 'Idle'),
            ],
          ),
          const SizedBox(height: PickforgeSpacing.xl),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 240,
                child: HairlinePanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const MonoEyebrow('Widget'),
                      const SizedBox(height: PickforgeSpacing.sm),
                      Text(
                        'PrimaryActionButton',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: PickforgeSpacing.xs),
                      const Text('lib/main.dart:42', style: PickforgeText.mono),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: PickforgeSpacing.xl),
              SelectionBracket(
                child: Container(
                  width: 150,
                  height: 86,
                  decoration: BoxDecoration(
                    color: PickforgeColors.surface2,
                    borderRadius:
                        BorderRadius.circular(PickforgeSpacing.radiusMd),
                    border: Border.all(color: PickforgeColors.hairline),
                  ),
                  alignment: Alignment.center,
                  child: const Text('Selected'),
                ),
              ),
              const SizedBox(width: PickforgeSpacing.xl),
              const SizedBox(
                width: 150,
                height: 86,
                child: HairlinePanel(
                  padding: EdgeInsets.zero,
                  color: PickforgeColors.surface,
                  child: BlueprintGrid(halo: true),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
