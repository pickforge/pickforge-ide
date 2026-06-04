# Manual Dogfood Preparation

This checklist is for the blockers that cannot be closed by headless CI. CI can
build and test Pickforge, but release dogfood needs visible desktop interaction
with real agent CLIs and real Flutter targets.

## What Codex Needs From The User

For a Linux dogfood pass, start the agent from a real desktop session:

```bash
cd /home/dev/Development/Personal/vibes/vibe-flutter-unified-unimplemented
scripts/dogfood_preflight.sh
```

The session needs:

- A visible desktop display with a window manager.
- The same user account that owns the repo and agent CLI credentials.
- `DISPLAY` and desktop input available to the shell running Codex.
- A prepared Android AVD, currently `Pixel_10`.
- Network access for real agent CLIs.
- Permission to launch the selected agent CLI against `fixtures/sample_flutter_app`
  or another throwaway Flutter project.

If the current shell is headless, use a normal desktop terminal or a VNC/Xpra
session with a window manager. Xvfb alone is not enough for the final signoff
because it has already produced blank root screenshots in this environment.

## Agent Model Decision

Use these agent/model pairings for manual dogfood:

- Codex: GPT 5.3 Codex Spark.
- OpenCode: DeepSeek V4 Flash.
- Claude Code: Sonnet 4.6.

Pickforge currently launches agent binaries by profile (`codex`, `opencode`,
`claude`) and does not pass model flags. Configure the desired default model in
each CLI before dogfood, or add profile-specific model settings as a separate
product change.

## Local Linux Dogfood Steps

1. Run `scripts/dogfood_preflight.sh` and save `build/dogfood/preflight.txt`.
2. Run `scripts/desktop_build_smoke.sh`.
3. Run `scripts/emulator_e2e.sh Pixel_10`.
4. Start Pickforge from the visible desktop session:

   ```bash
   fvm flutter run -d linux
   ```

5. Add `fixtures/sample_flutter_app` as a Pickforge project.
6. Bind `Pixel_10` or attach to the sample app's VM Service.
7. Pick a user-code widget and verify the inspector metadata and screenshot.
8. Select/create a chat for the active project.
9. Press **Forge it** and verify the prompt appears in the visible embedded
   terminal.
10. Verify `.pickforge/skill-active.md`, `.pickforge/widget-context.md`,
    `.pickforge/initial-prompt.md`, and available screenshots in the sample
    project.
11. Repeat the Forge prompt delivery once for each configured agent profile.

## Missing Tool Cases

Run these against the built desktop bundle in a disposable shell so the normal
user environment is not modified:

```bash
scripts/desktop_build_smoke.sh
empty_path="$(mktemp -d)"
PATH="$empty_path" build/linux/x64/debug/bundle/pickforge
```

To make one tool available while hiding the rest, symlink only that command into
the temporary PATH before launching the bundle.

Verify setup checks and terminal startup failures are recoverable for:

- Missing `claude`.
- Missing `codex`.
- Missing `opencode`.
- Missing `adb`.

Do not mark a missing-binary case complete unless the app UI shows the expected
recoverable state and the normal PATH works again afterward.

## Native Host Passes

macOS/iOS dogfood needs a macOS host with Xcode and an iOS Simulator. Windows
dogfood needs a native Windows host with Visual Studio desktop tooling. On those
hosts, run:

```bash
scripts/dogfood_preflight.sh
scripts/desktop_build_smoke.sh
fvm flutter test --reporter=compact
```

Then repeat the visible desktop project binding, widget pick, Forge prompt, and
`.pickforge/` context-file checks on that platform.
