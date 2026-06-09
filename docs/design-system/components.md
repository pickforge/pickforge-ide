# Components

The signature component library lives in `lib/shared/components/` and is
exported from the barrel `components.dart`:

```dart
import 'package:pickforge/shared/components/components.dart';
```

These encode the brand's visual DNA. Reach for them before hand-rolling UI. See
the rendered gallery at `test/goldens/baselines/component_gallery.png`
(regenerate via `fvm flutter test test/goldens/component_gallery_test.dart
--update-goldens`).

## MonoEyebrow

Uppercase, wide-tracked monospace section label — the brand "eyebrow".

```dart
MonoEyebrow('Get started', tick: true)   // tick = small ember bar prefix
```
Use for section headers ("PROJECTS", "CONTEXT ATTACHMENTS", "GET STARTED").

## EmberButton

The signature primary CTA — an ember pill with a glow and a magnetic
hover/press micro-interaction. Rare and loud; honor the one-ember rule.

```dart
EmberButton(
  label: l10n.forgeItButton,
  icon: Icons.auto_fix_high,
  expand: true,            // fill width
  onPressed: forgeAction,  // null => disabled state
)
```
For routine actions use the themed `FilledButton` / `OutlinedButton` /
`TextButton` instead (the theme already styles them).

## StatusPill + EmberDot

Semantic status chip with a leading dot; the dot can pulse for "live" states.

```dart
StatusPill(label: 'Running', intent: StatusIntent.live, pulsing: true)
EmberDot(color: StatusIntent.connected.color, pulsing: false)
```
`StatusIntent`: neutral · live (ember) · connected (green) · warning (amber) ·
error (red) · info (blue). Note: `StatusPill` **uppercases** its label.

## SelectionBracket

Four L-corner marks (the logo DNA, ember top-right) framing the active /
selected / focused element. Animates in/out via `active`, reduced-motion aware.

```dart
SelectionBracket(active: isActive, child: chatRow)
```

## HairlinePanel

The base card/panel — hairline border on a surface fill.

```dart
HairlinePanel(
  color: PickforgeColors.surface1,   // default
  strong: false,                     // 14% border instead of 8%
  glass: false,                      // subtle surface1→surface2 gradient
  child: ...,
)
```

## BlueprintGrid

A faint blueprint grid backdrop for empty states / onboarding, with an optional
ember halo (a backdrop — exempt from the one-ember rule).

```dart
const BlueprintGrid(halo: true)   // behind hero content in a Stack
```

## Composition example (onboarding hero)

```dart
Stack(children: [
  const Positioned.fill(child: IgnorePointer(child: BlueprintGrid(halo: true))),
  Center(child: Column(children: [
    SelectionBracket(child: emberForgeMark),
    const MonoEyebrow('Widget-level AI context', tick: true),
    Text(heading, style: textTheme.displaySmall),
    EmberButton(label: 'Pick folder', icon: Icons.add, onPressed: pick),
  ])),
]);
```

## Adding a component

Put it in `lib/shared/components/`, export it from `components.dart`, build it
from tokens only, gate any animation on `ReduceMotion`, add it to
`component_gallery_test.dart`, and document it here.
