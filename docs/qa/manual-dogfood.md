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
4. Run `scripts/linux_deb_container_install_smoke.sh --skip-build` with Docker
   or Podman to install the `.deb` in a clean Ubuntu container and verify
   package metadata, installed files, dynamic linkage, and first-run liveness.
   This still does not replace a visible install on a fresh desktop VM.
5. Run `scripts/linux_deb_signing_smoke.sh --skip-build` to validate detached
   `.deb` and checksum signing with an ephemeral local GPG key.
6. Run `scripts/linux_appimage_smoke.sh --skip-build` to validate the AppImage
   package contents and first-run liveness.
7. Run `scripts/emulator_e2e.sh Pixel_10`.
8. Run `scripts/linux_visible_diagnostics_smoke.sh` from the visible desktop
   session to capture setup-check screenshots for available, missing-agent, and
   missing-`adb` cases.
9. Run `scripts/agent_profile_pty_smoke.sh` to validate installed Claude Code,
   Codex, and OpenCode profile launch plus Pickforge prompt delivery through
   the embedded PTY adapter. The script writes transcripts and copied context
   artifacts under `build/dogfood/agent-profile-pty/`.
10. To validate dirty-worktree review without altering the real app checkout,
   prepare a disposable dogfood project:

   ```bash
   scripts/dirty_git_dogfood_setup.sh --source /home/dev/Development/Personal/MyGamesList/app
   ```

   Use the printed project root when checking the dirty-worktree warning,
   checkpoint action, and untracked-file preservation.
11. Start Pickforge from the visible desktop session:

   ```bash
   fvm flutter run -d linux
   ```

12. Add `fixtures/sample_flutter_app`, the dirty-git dogfood project, or another
    throwaway Flutter app as a Pickforge project.
13. Bind `Pixel_10` or attach to the sample app's VM Service.
14. Pick a user-code widget and verify the inspector metadata and screenshot.
15. Select/create a chat for the active project.
16. Press **Forge it** and verify the prompt appears in the visible embedded
   terminal.
17. Verify `.pickforge/skill-active.md`, `.pickforge/widget-context.md`,
    `.pickforge/initial-prompt.md`, and available screenshots in the sample
    project.
18. Repeat visible Forge prompt delivery for any agent profile not covered by
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
dogfood needs a native Windows host with Visual Studio desktop tooling. Use
`docs/qa/native-host-validation.md` as the authoritative runbook for the exact
commands, manual pass criteria, and required evidence. On those hosts, run at
minimum:

```bash
scripts/dogfood_preflight.sh
scripts/desktop_build_smoke.sh
scripts/desktop_launch_smoke.sh
fvm flutter test --reporter=compact
```

The launch smoke only verifies the built app starts and stays alive briefly.
Then repeat the visible desktop project binding, widget pick, Forge prompt, and
`.pickforge/` context-file checks on that platform.
