# Motion

Source: `lib/shared/motion/pickforge_motion.dart` (tokens) and
`lib/shared/motion/reduce_motion.dart` (the reduced-motion gate).

PickForge motion is restrained and purposeful. There is **one signature
easing** and a small set of named durations. Snappy in, gentle out.

## The forge easing

`PickforgeMotion.forge` = `Cubic(0.16, 1, 0.3, 1)` — the brand's `--ease-forge`.
Use it for reveals, selection, and hover. For two-way state (expand/collapse,
toggles) `PickforgeMotion.curve` (easeInOutCubic) reads better; for a small
pop-in use `PickforgeMotion.emphasized`.

## Durations

| Token      | Value   | Use |
| ---------- | ------- | --- |
| `micro`    | 110ms   | Presses, tiny state flips. |
| `fast`     | 180ms   | Hovers, focus rings, small fades. |
| `standard` | 260ms   | Default (selection, panels, dialogs). |
| `slow`     | 420ms   | Deliberate entrances / route transitions. |
| `reveal`   | 640ms   | Cinematic reveals (onboarding hero, forge dispatch). |
| `pulse`    | 2400ms  | Looping "live"/connected pulse rings. |
| `breath`   | 6000ms  | Slow ambient ember breath behind hero surfaces. |

## Reduced motion is mandatory

Every animation must collapse to an instant state change when the user has
reduced motion enabled. Use the gate:

```dart
// Returns Duration.zero when reduced motion is on.
duration: ReduceMotion.duration(context, PickforgeMotion.standard),

// Or branch explicitly:
if (ReduceMotion.of(context)) { /* jump to end state */ }
```

The signature components already honor this internally (`EmberButton`,
`StatusPill`, `SelectionBracket`). `flutter_animate` entrances must be gated by
hand — only apply `.animate()` when `!ReduceMotion.of(context)` (this also keeps
golden tests, which set `disableAnimations: true`, deterministic).

## Patterns in use

- **Hero entrance** (onboarding): `widget.animate().fadeIn(reveal, forge)
  .slideY(begin: 0.04, …)`, gated by reduced motion.
- **Selection/hover**: `AnimatedContainer(duration: ReduceMotion.duration(
  context, PickforgeMotion.fast), curve: PickforgeMotion.forge)` for background
  / marker changes on the active row.
- **Live pulse**: `<StatusPill pulsing />` for running/connected status — the
  bracket indicator pulses, not a dot.

## Do / don't

- ✅ `curve: PickforgeMotion.forge`  ❌ `curve: Curves.easeIn`
- ✅ `ReduceMotion.duration(context, PickforgeMotion.fast)`  ❌ raw `Duration(milliseconds: 200)`
- ✅ gate `.animate()` on reduced motion  ❌ unconditional entrance animations
