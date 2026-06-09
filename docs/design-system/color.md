# Color

Source: `lib/shared/theme/pickforge_colors.dart`. Applied app-wide through
`PickforgeTheme` (`pickforge_theme.dart`), which fully populates the Material 3
`ColorScheme` so Material defaults never leak.

## Surfaces (the cold canvas)

| Token                      | Hex        | Use |
| -------------------------- | ---------- | --- |
| `PickforgeColors.surface`  | `#0A0A0B`  | Page background. The brand black. |
| `PickforgeColors.surface1` | `#0F0F11`  | Cards, panels, sidebars (first elevation). |
| `PickforgeColors.surface2` | `#141417`  | Raised panels, hover fills, terminal chrome. |
| `PickforgeColors.surface3` | `#1B1B1F`  | Popovers, menus, tooltips. |

`bg0`/`bg1`/`bg2` are back-compat aliases of `surface`/`surface1`/`surface2`.

## Text

| Token      | Hex       | Use |
| ---------- | --------- | --- |
| `textHi`   | `#F2F2F3` | Primary text (off-white, not pure white). |
| `textMed`  | `#A0A0A6` | Secondary text, icons. |
| `textLow`  | `#6E6E75` | Muted text, captions, eyebrows (`muted` alias). |

## Ember — the one accent

| Token        | Hex       | Use |
| ------------ | --------- | --- |
| `ember`      | `#FF7A1A` | THE accent: primary CTA, active/selected, live status. |
| `emberSoft`  | `#FF9A4A` | Hover. |
| `emberDeep`  | `#CC5E0C` | Pressed / focus-ring borders. |

> **One ember per composition.** If two things are ember on one surface, one of
> them is wrong. Status colors below are *not* ember and don't count.

## Hairlines

| Token            | Value          | Use |
| ---------------- | -------------- | --- |
| `hairline`       | white @ 8%     | Default border (`stroke` alias). |
| `hairlineStrong` | white @ 14%    | Emphasis borders, dividers. |

Never use a border darker than 14% on dark surfaces — it disappears.

## Status / semantic (functional, minimal)

| Token       | Hex       | Meaning |
| ----------- | --------- | ------- |
| `connected` | `#3DD68C` | Shipped / connected / online. |
| `warning`   | `#F2B53A` | Booting / beta / caution. |
| `error`     | `#FF6B5C` | Failure. |
| `info`      | `#7AA2FF` | Neutral secondary accent. |

These map to `StatusIntent` (see [components.md](components.md)).

## Ember glow

`lib/shared/theme/pickforge_elevation.dart` — one glow, three intensities:
`PickforgeElevation.emberSoft` / `ember` / `emberStrong` (BoxShadow lists), plus
`PickforgeElevation.emberHalo()` (a radial backdrop gradient, exempt from the
one-ember rule) and neutral `raised` / `overlay` shadows for popovers/dialogs.

## Do / don't

- ✅ `color: PickforgeColors.surface1`  ❌ `color: Color(0xFF111113)`
- ✅ `border: Border.all(color: PickforgeColors.hairline)`  ❌ `Colors.grey.shade800`
- ✅ ember on the active chat only  ❌ ember on the active chat *and* its status chip
- ✅ `colorScheme.error` for Material widgets  ❌ inventing a new red
