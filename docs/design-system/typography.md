# Typography

Source: `lib/shared/theme/pickforge_typography.dart`. Two typefaces, bundled as
OFL fonts in `assets/fonts/` and registered in `pubspec.yaml`:

- **Geist** (`kPickforgeSans`) — the human voice. Default for all UI text;
  wired as `ThemeData.fontFamily`, so you rarely set it explicitly.
- **Geist Mono** (`kPickforgeMono`) — the machine voice: terminal, IDs, paths,
  tabular values, and eyebrows.

Use `Theme.of(context).textTheme.*` for the scale; use `PickforgeText.*` for the
mono voice.

## Scale (`pickforgeTextTheme`)

| TextTheme slot   | Size | Weight | Tracking | Use |
| ---------------- | ---- | ------ | -------- | --- |
| `displayLarge`   | 42   | 700    | tight    | Hero. |
| `displayMedium`  | 34   | 700    | tight    | Big moments. |
| `displaySmall`   | 28   | 600    | tight    | Onboarding heading. |
| `headlineLarge`  | 25   | 600    | tight    | Stage headers. |
| `headlineMedium` | 21   | 600    | tight    | Section headers. |
| `headlineSmall`  | 18   | 600    | tight    | Sub-section. |
| `titleLarge`     | 16   | 600    | —        | Card / panel titles. |
| `titleMedium`    | 14   | 600    | —        | List headers. |
| `titleSmall`     | 13   | 600    | —        | Dense titles. |
| `bodyLarge`      | 15   | 400    | —        | Comfortable body. |
| `bodyMedium`     | 13   | 400    | —        | Default body (dev-tool density). |
| `bodySmall`      | 12   | 400    | —        | Captions (`textMed`). |
| `labelLarge`     | 13   | 500    | wide     | Buttons. |
| `labelMedium`    | 12   | 500    | wide     | Compact labels (`textMed`). |
| `labelSmall`     | 11   | 500    | wide     | Smallest labels (`textMed`). |

Display sizes carry tight (negative) tracking; labels carry positive tracking.

## The mono voice (`PickforgeText`)

- `PickforgeText.eyebrow` — 10px Geist Mono, uppercase intent, **wide tracking
  (~0.18em)**, muted. The brand "eyebrow". Prefer the `MonoEyebrow` component.
- `PickforgeText.mono` — 12px Geist Mono with tabular figures, for IDs, paths,
  counts.

The terminal/code surfaces read the mono family from the `PickforgeMonoTheme`
theme extension (`fontFamily: 'GeistMono'`).

## Do / don't

- ✅ `style: Theme.of(context).textTheme.titleMedium`
- ✅ `MonoEyebrow('Get started', tick: true)` for a section label
- ✅ `Text(path, style: PickforgeText.mono)` for a file path
- ❌ `TextStyle(fontFamily: 'Inter', fontSize: 13)` — use the scale
- ❌ hard-coded `fontSize:` numbers — use a `textTheme` slot
