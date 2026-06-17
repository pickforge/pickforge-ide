# Milestone 3 · Slice 3B — Flutter selection context mapper

Depends on 3A (`FlutterTargetAdapter` shell). ADDITIVE, pure: maps the existing
`SelectedWidget` into a generic `TargetSelection` while retaining the full Flutter
selection alongside it. No runtime wiring, no behavior change. Satisfies the M3 item
"Make Flutter context builder produce a generic `TargetSelection` plus Flutter-specific
details" and "Keep VM Service inspector as source of truth" (we map, never replace).

## Design (Codex-reviewed)

- Mapper lives in `lib/core/targets/flutter/flutter_selection_mapper.dart` — NOT a
  method on the adapter (the adapter stays a `const` value with no deps).
- Do NOT add `toJson()` to `TargetSelection`/`TargetDetection` — keep the generic
  models serialization-free until a real cross-target wire consumer needs them.
- The generic projection is deliberately lossy (one screenshot slot, properties as a
  JSON string); `flutterSelection` preserves every field, so STOP condition (a)
  (no precision loss) holds — the rich `SelectedWidget` is always retained.

### Field mapping (`SelectedWidget` → `TargetSelection`)

| `TargetSelection` | source |
|---|---|
| `id` | `node.id` |
| `label` | `node.className` |
| `sourcePath` | `node.creationLocation?.file` |
| `sourceLine` | `node.creationLocation?.line` |
| `propertiesJson` | `jsonEncode(propertiesJson)` |
| `screenshotPath` | `screenshotPath` (widget screenshot) |

## Files
- Create `lib/core/targets/flutter/flutter_selection_mapper.dart`
  (`FlutterSelectionContext` {`targetSelection`, `flutterSelection`, `toJson()`} +
  `FlutterSelectionMapper.map(SelectedWidget)`).
- Create `test/core/targets/flutter_selection_mapper_test.dart`.
- Touch nothing else (no adapter, MCP, IPC, picker, inspector runtime).

## Tests
Build a fully-populated `SelectedWidget` (ancestors, snippet, both screenshot paths,
nested `propertiesJson`, children, creation location). Assert each mapped field;
`jsonDecode(targetSelection.propertiesJson!)` equals the original map;
`context.toJson()['flutter']` equals `selected.toJson()`. Add a null-location case.

## Verification
1. `fvm dart format --set-exit-if-changed lib/core/targets/flutter test/core/targets/flutter_selection_mapper_test.dart`
2. `fvm flutter analyze`
3. `fvm flutter test test/core/targets/`

## STOP conditions
- No precision loss: the full `SelectedWidget` must survive in `flutterSelection`.
- No runtime wiring in 3B (routing the IPC selection through this is later/optional).
