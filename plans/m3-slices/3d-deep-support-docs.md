# Milestone 3 · Slice 3D — Flutter deep-support docs + delegation boundary

Depends on 3A/3B/3C. Docs-only (+ one adapter doc comment). Satisfies "Update docs to
identify Flutter as deep support" and records the honest deferral boundary.

## Changes
- `docs/architecture/pickforge-mcp.md`:
  - Add `get_current_selection` + `capture_target_screenshot` to the Methods list,
    stating they currently return the same payloads as their legacy counterparts.
  - New "Flutter deep support" section: Flutter is the reference target; list the
    live service owners (VM Service inspector, `RunSession`, `AdbScreenshotCapturer`,
    `ContextStorageService`) and `FlutterSelectionMapper`; state adapter-owned live
    sessions are deferred until a second target (RN, M4) proves the shared surface.
- `lib/core/targets/flutter_target_adapter.dart`: doc comment updated to drop the
  forward promise of imminent operation delegation; reflects the real boundary.

## Verification
1. `fvm flutter analyze` (0 issues)
2. `fvm flutter test` (full — additive, stays green)

## STOP conditions
- Don't claim deep source mapping for non-Flutter targets; Flutter only.
