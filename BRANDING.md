# PickForge — Branding & Logo Playbook

Reference doc for the brand's visual identity. Kept in the project root alongside `SOCIAL.md` and `EMAIL.md`. Revisit before any public-facing asset ships.

## Locked tokens (from spec §10)

| Token | Value | Usage |
|---|---|---|
| **Accent / ember** | `#FF7A1A` (forge-ember orange) | Primary brand color. One glowing dot/element per composition, never a whole gradient. |
| **Ink (dark)** | `#17171A` | Icon/wordmark on light backgrounds. |
| **Surface (dark)** | `#0A0A0B` | Near-black dark-mode background. Never pure `#000`. |
| **Text (on dark)** | `#F2F2F3` | Wordmark on dark. |
| **Muted grey** | `#6E6E75` | Tagline, sub-labels. |
| **Chrome typeface** | Geist Sans (Bold for wordmark), fallback Inter SemiBold. | Wordmarks, UI headings. |
| **Mono typeface** | Berkeley Mono, fallback JetBrains Mono. | Code, widget-tree items. Never in wordmark. |

## Reference aesthetic

Logo and chrome target the 2026 power-user dev-tool pocket: **Linear, Raycast, Arc, Cursor, Zed, Warp, Vercel, Supabase**. Shared traits we copy:

- Single iconic mark (scales to favicon cleanly).
- Flat vector. No gradients. No 3D. No drop shadows.
- No mascots or characters. Ever.
- No literal fire, sparks, smoke — the ember is an *abstract* dot, not a flame.
- No Flutter logo, no third-party trademarks inside our own mark.
- Bold geometric sans for the wordmark. Tight letter-spacing (~-2%).
- Icon + wordmark are separable; both must work alone.

## What went wrong with the first iteration

Reviewed against the above:

1. **Kitchen-sink composition** — phone mockup + chatbot mascot + Flutter logo + cursor + terminal bubble + wordmark all competing. No single mark.
2. **Mascot robot** was generic 2023-ChatGPT-aesthetic. Reference products never use mascots.
3. **Flutter logo in the background** is Google's trademark — real legal / brand-guideline risk.
4. **Mascots die at small sizes.** At 32×32 favicon the face becomes mush.
5. **Tagline text broken.** AI-image-gen can't do clean text; "PICK. TWEAK. FORGE BETTER APPS." was cut off. Tagline has to be vector-set later, not image-gen'd.
6. **Blue+violet gradient** disagrees with the locked `#FF7A1A` ember. Using a different brand color undermines the rest of the identity.

## Concept directions

Four viable directions. Pick ONE and commit.

| # | Concept | One-liner | Scales to favicon? |
|---|---|---|---|
| **A** ★ | Selection-box bracket with one corner replaced by a glowing ember | Directly translates "widget picker + forge" into a single mark. | Yes |
| **B** | Cursor tip striking an anvil, ember at contact point | Most literal forge metaphor. Slightly busier than A. | Yes, with care |
| **C** | Geometric "P" letter-mark whose bowl becomes a selection-corner handle | Linear/Raycast pattern (letter marks). Type-driven. | Yes |
| **D** | `[ ● ]` — ember centered between two brackets | Ultra-minimal. Most Raycast/Warp-leaning. | Yes (easiest) |

**Recommended: A** — clearest translation of the product mechanic, single iconic mark, works mono + color, straightforward to rebuild in Figma after concept exploration.

## Image-generation prompts

Use these with ChatGPT / Midjourney / Ideogram to *explore concepts*. Image-gen cannot produce a final asset — plan to rebuild the winning direction in Figma or Illustrator for a pixel-clean, exportable SVG.

### Concept A — Selection-box + ember (recommended)

```
Minimal vector logo for "PickForge", a developer tool for Flutter.
Single geometric mark: a square selection marquee with four small
corner handles (classic design-tool selection box), rendered as
clean hairline strokes. One corner handle — the top-right — is
replaced by a solid rounded shape that reads as a glowing ember,
in warm orange (#FF7A1A). Thin dashed stroke between handles on
three sides; solid accent on the ember corner.

Style: Linear, Raycast, Zed, Vercel aesthetic. Flat vector. No
gradients. No 3D. No drop shadows. No mascots, characters, robots,
phones, brackets-around-text, or skeuomorphic detail. No literal
fire, flames, sparks, or smoke. No Flutter logo. No text or
letters in the icon itself.

Background: pure white (for light) or near-black #0A0A0B (for dark)
— generate both variants. Mark is centered, comfortable margin,
square 1:1 canvas. Stroke weight balanced for both 512px export
and 32px favicon clarity.
```

### Concept B — Anvil + cursor

```
Minimal vector logo mark for "PickForge". A simplified geometric
mouse cursor (arrow) meets a geometric anvil silhouette at a single
contact point. At that contact point, one small solid dot rendered
as a glowing ember in warm orange (#FF7A1A).

Both cursor and anvil drawn as flat geometric primitives: cursor
is a clean arrow outline, anvil is reduced to a trapezoid on a
rectangle base. Monochrome dark grey (#17171A) on white, except
for the ember dot. No shading, no gradients, no 3D, no sparks or
fire effects. No text, no Flutter logo, no robots or mascots.

Style references: Linear, Raycast, Vercel, Zed. Flat vector, balanced
stroke weights. Square 1:1 canvas, centered composition, generous
padding. Exportable as SVG-equivalent flat shapes.
```

### Concept C — Geometric "P" letter-mark

```
Minimal geometric letter-mark logo for "PickForge". A single letter
"P" rendered in a bold geometric sans-serif. The bowl of the P is
opened and restyled as a design-tool selection corner handle (like
the corner of a marquee selection box). A small solid ember dot in
warm orange (#FF7A1A) sits at the top-right of the selection corner.

Everything else is dark charcoal (#17171A) on white, or near-white
on near-black (#0A0A0B) — generate both. Flat vector, no gradients,
no 3D, no textures. No text beyond the single letter. Clean modern
grotesk. No mascots, no Flutter logo, no phones.

Inspired by Linear's "L" mark and Raycast's "R" mark. 1:1 canvas,
centered, generous padding.
```

### Concept D — Ember in brackets

```
Ultra-minimal logo mark: two geometric bracket shapes [ ] in dark
charcoal (#17171A), with a single solid dot between them rendered
as a glowing ember in warm orange (#FF7A1A). The dot sits perfectly
centered between the brackets.

Flat vector. No gradients, no 3D, no shadows. Brackets drawn as
clean geometric strokes with squared corners, equal weight. Square
1:1 canvas, white background (and a near-black variant on #0A0A0B).
No text, no letters, no mascots, no Flutter logo, no fire or sparks.

Style: Warp terminal, Raycast, Vercel. Designed to read at 16px,
32px, and 512px equally well.
```

## Wordmark pairing

The icon and wordmark are separate assets. Either can stand alone. Together they form the horizontal lockup.

- **Type:** "PickForge" (capital P and F, always).
- **Typeface:** Geist Sans Bold (primary), Inter SemiBold (fallback), Söhne Bold (paid alternative if commissioned).
- **Letter-spacing:** -2% (slightly tight).
- **Optical weight:** wordmark stroke should visually balance the icon stroke at the same display size.
- **Color:**
  - On light: `#17171A` (ink).
  - On dark: `#F2F2F3` (text-on-dark).
- **Never:** all-caps, italic, two-color split down the wordmark, gradients, fire/spark ornaments.

### Tagline (below or beside the wordmark, not stacked)

- **Copy:** `Widget-level AI context for Flutter.`
- **Typeface:** Inter Regular.
- **Size:** ~1/3 of the wordmark.
- **Color:** `#6E6E75` (muted grey).
- **Drop:** the older `PICK. TWEAK. FORGE BETTER APPS.` tagline — too wordy for a logo lockup, and image-gen mangled it.

## Asset matrix to eventually produce

When the concept is locked, produce at least this set of assets:

- `logo-icon-light.svg` — mark on white.
- `logo-icon-dark.svg` — mark on near-black.
- `logo-icon-mono.svg` — single-color variant (black only), for stencil/merch/print.
- `logo-wordmark-light.svg` — wordmark only.
- `logo-wordmark-dark.svg`
- `logo-lockup-horizontal-light.svg` — icon + wordmark side by side.
- `logo-lockup-horizontal-dark.svg`
- `logo-lockup-stacked-light.svg` — icon above wordmark (social avatars, sometimes splash).
- `logo-lockup-stacked-dark.svg`
- `favicon.ico` — 16, 32, 48 multi-resolution.
- `favicon.svg` — modern browsers prefer SVG favicons.
- `apple-touch-icon.png` — 180×180.
- `og-image.png` — 1200×630 for social previews.

Canonical assets now live under `assets/branding/` in this repo and `branding-visual/assets/pickforge/` in the studio brand kit.

## Practical next step

1. Run the **Concept A** prompt first. Iterate 3-5 times; each gen is different.
2. Pick the best *concept*, not the best *rendering*. AI output is a reference, not a final asset.
3. Rebuild the chosen concept in Figma or Illustrator with proper geometry + the exact `#FF7A1A` ember token. 30-60 minutes of work gets you a pixel-clean SVG.
4. **Test at 16×16 favicon scale.** If it doesn't read there, simplify until it does. This is the single most-skipped logo test.
5. Export the full asset matrix above. Commit to `assets/brand/`.

## Rules to live by

- **One mark, one ember dot.** Never multiple embers. Never the ember spread across the whole composition.
- **No mascots.** Ever.
- **No Flutter logo inside our mark.** We *target* Flutter, we don't *co-brand* with it.
- **Text lives in vector tools, not image-gen.** AI consistently mangles letters and spacing.
- **Test at favicon size before committing.** Logos that look amazing at 512px and mushy at 16px are failed designs.
- **No gradients in the mark itself.** The UI can use gradients sparingly; the *logo* stays flat.
- **The icon must survive monochrome.** If removing the ember breaks the concept, the mark leans too hard on color.

## Review date

Revisit after first 100 users if feedback suggests the mark doesn't read. Otherwise leave it alone — brand consistency compounds.
