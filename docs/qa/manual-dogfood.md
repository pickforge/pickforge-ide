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
3. Run `scripts/linux_deb_smoke.sh --skip-build` after a Linux release build
   and package pass to validate the rootless `.deb` contents and extracted
   bundle launch. This is not a substitute for a true sudo install on a fresh
   machine.
4. Run `scripts/linux_deb_signing_smoke.sh --skip-build` to validate detached
   `.deb` and checksum signing with an ephemeral local GPG key.
5. Run `scripts/emulator_e2e.sh Pixel_10`.
6. Run `scripts/linux_visible_diagnostics_smoke.sh` from the visible desktop
   session to capture setup-check screenshots for available, missing-agent, and
   missing-`adb` cases.
7. Run `scripts/agent_profile_pty_smoke.sh` to validate installed Claude Code,
   Codex, and OpenCode profile launch plus Pickforge prompt delivery through
   the embedded PTY adapter. The script writes transcripts and copied context
   artifacts under `build/dogfood/agent-profile-pty/`.
8. Start Pickforge from the visible desktop session:

   ```bash
   fvm flutter run -d linux
   ```

9. Add `fixtures/sample_flutter_app` as a Pickforge project.
10. Bind `Pixel_10` or attach to the sample app's VM Service.
11. Pick a user-code widget and verify the inspector metadata and screenshot.
12. Select/create a chat for the active project.
13. Press **Forge it** and verify the prompt appears in the visible embedded
   terminal.
14. Verify `.pickforge/skill-active.md`, `.pickforge/widget-context.md`,
    `.pickforge/initial-prompt.md`, and available screenshots in the sample
    project.
15. Repeat visible Forge prompt delivery for any agent profile not covered by
    `scripts/agent_profile_pty_smoke.sh`, or when validating model response and
    file-edit behavior rather than PTY launch/prompt delivery.

## Missing Tool Cases

Run the diagnostics smoke first. It uses a controlled PATH and disables
login-shell PATH merging so missing-tool cases are deterministic:

```bash
scripts/missing_tool_smoke.sh
scripts/linux_visible_diagnostics_smoke.sh
```

The visible diagnostics script runs the same scenarios against the desktop app
with a controlled PATH, probes the live Flutter inspector tree, and writes
screenshots under `build/dogfood/visible-diagnostics/`. Set
`PICKFORGE_INHERITED_ENV_ONLY=1` for any additional manual PATH permutations;
otherwise the app intentionally resolves the user's login-shell PATH and may
find tools that the disposable shell hides.

Verify setup checks and terminal startup failures are recoverable for:

- Missing `claude`.
- Missing `codex`.
- Missing `opencode`.
- Missing `agent`.
- Missing `gemini`.
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
