# Pickforge Release Blockers

This register tracks the remaining public-release gates that are not closed by
the current Linux dogfood evidence. Use it with `docs/release-checklist.md` and
do not remove an item until its clearance evidence exists.

## Active Blockers

| ID | Gate | Status | Clearance evidence |
| --- | --- | --- | --- |
| RB-001 | Linux fresh-machine visible install | Blocked on a fresh VM or clean desktop host with sudo access | Install the generated `.deb`, run `scripts/linux_installed_visible_smoke.sh` against `/usr/bin/pickforge`, and save `build/dogfood/linux-installed-visible/**` plus a screenshot showing the installed app. |
| RB-002 | Linux release signing secret | Blocked on release secret configuration or explicit unsigned-release decision | Configure `PICKFORGE_GPG_PRIVATE_KEY_BASE64` for protected tags and run `scripts/linux_deb_signing_smoke.sh --skip-build`, or record an approved unsigned-release decision before tagging. |
| RB-003 | macOS and iOS native dogfood | Blocked on native macOS host | Run `docs/qa/native-host-validation.md` for iOS Simulator and macOS desktop targets, saving the listed VM Service, inspector, Pickforge screenshot, and `.pickforge/` artifacts. |
| RB-004 | macOS signing, notarization, Gatekeeper, and Sparkle | Blocked on Apple Developer ID credentials and appcast readiness | Sign and notarize a release artifact on macOS, verify Gatekeeper launch, document Sparkle appcast and rollback readiness, then link the artifacts from the release checklist. |
| RB-005 | Windows native dogfood | Blocked on native Windows host | Run `docs/qa/native-host-validation.md` for the Windows desktop target, saving the listed VM Service, inspector, Pickforge screenshot, and `.pickforge/` artifacts. |
| RB-006 | Windows signing, SmartScreen, and package-manager submission | Blocked on Authenticode certificate and release package decision | Sign the Windows release artifact, run native install/launch verification, record SmartScreen behavior, and prepare winget or Scoop submission metadata. |
| RB-007 | Cursor and Gemini installed-agent dogfood | Blocked on those local binaries being installed, or an explicit release-scope decision | Either install `agent` and `gemini` and repeat visible Forge prompt delivery, or record that missing-binary recovery is sufficient for the current release. |

## Future Backlog, Not MVP Release Blockers

These plan items remain unchecked because they are future product direction or
conditional workflow demand. They should not block the local MVP dogfood build
unless the release scope changes.

- P5.T2 passive hover preview/highlight over a live emulator mirror.
- P7.T5 Pickforge Pro backend features: auth, cloud sync, team sync, premium
  skill packs, multi-agent orchestration, and Stripe billing.
- P8.T1 multi-package architecture reassessment after MVP dogfood.
- P8.T2 external terminal restoration, only if users ask for it.

## Last Updated

- 2026-06-04: Created from the current plan state after Linux visible dogfood,
  Linux package/rootless/container/AppImage/signing smokes, installed-agent PTY
  smoke for Claude Code/Codex/OpenCode, and native-host validation runbook
  creation.
