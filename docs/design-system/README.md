# PickForge Design System

The in-app design system for the PickForge desktop app. It is the Flutter
implementation of the brand defined in
[`../../../branding-visual/`](../../../branding-visual) — read that for the
canonical "why"; read this for the "how" in code.

> **One sentence:** dark-first, one ember on a cold canvas, Geist for the human
> voice and Geist Mono for the machine voice, hairline structure, and a single
> signature easing for motion.

## The ten rules

1. **Never type a raw hex, font size, radius, or duration in a widget.** Use a
   token. If the token is missing, add it to the token file first.
2. **One ember per composition.** `PickforgeColors.ember` is the only accent —
   reserve it for the single most important thing on a surface (the primary
   CTA, the active/selected element, a live status). Everything else is
   surface, text, hairline, or a semantic status color.
3. **Geist is the default font** (wired via `PickforgeTheme`). Don't set
   `fontFamily` unless you need the mono voice (`GeistMono` / `PickforgeText`).
4. **Structure with hairlines, not heavy borders.** `PickforgeColors.hairline`
   (8% white) by default; `hairlineStrong` (14%) for emphasis. Never darker.
5. **Surfaces are flat and explicit** — `surface` → `surface1` → `surface2` →
   `surface3`. No Material elevation tint (the theme zeroes `surfaceTint`).
6. **Motion uses one easing:** `PickforgeMotion.forge` (`cubic-bezier(0.16, 1,
   0.3, 1)`). Snappy in, gentle out.
7. **Every animation honors reduced motion.** Gate with `ReduceMotion.of` /
   `ReduceMotion.duration` (`lib/shared/motion/reduce_motion.dart`).
8. **Compose with the signature components** in `lib/shared/components/`
   (`MonoEyebrow`, `StatusPill`, `EmberButton`, `SelectionBracket`,
   `HairlinePanel`, `BlueprintGrid`, `EmberDot`) before hand-rolling UI.
9. **Section labels are mono eyebrows** (`MonoEyebrow`) — uppercase, wide
   tracking, optional ember tick.
10. **Restraint is the brand.** It's a dense developer tool. Quiet by default;
    loud only where it matters.

## Where things live

| Concern        | Path |
| -------------- | ---- |
| Color tokens   | `lib/shared/theme/pickforge_colors.dart` |
| Typography     | `lib/shared/theme/pickforge_typography.dart` |
| Spacing/radii  | `lib/shared/theme/pickforge_spacing.dart` |
| Elevation/glow | `lib/shared/theme/pickforge_elevation.dart` |
| ThemeData      | `lib/shared/theme/pickforge_theme.dart` |
| Motion tokens  | `lib/shared/motion/pickforge_motion.dart` |
| Reduced motion | `lib/shared/motion/reduce_motion.dart` |
| Components     | `lib/shared/components/` (barrel: `components.dart`) |
| Fonts (assets) | `assets/fonts/` (Geist + Geist Mono, OFL) |
| Terminal theme | `lib/core/terminal/terminal_themes.dart` |

## Docs in this folder

- [color.md](color.md) — palette, surfaces, status, the ember glow
- [typography.md](typography.md) — Geist scale, mono voice, eyebrows
- [motion.md](motion.md) — durations, the forge easing, reduced motion
- [components.md](components.md) — the signature component library
- [terminal.md](terminal.md) — embedded terminal colors / ANSI handling

## Verifying visual work

The golden tests render every key screen + a component gallery + the terminal
to PNGs under `test/goldens/baselines/`. After a visual change:

```bash
fvm flutter test test/goldens/ --update-goldens   # regenerate
git diff --stat test/goldens/baselines             # review what moved
```

Then open the PNGs and confirm the change is intentional before committing.
