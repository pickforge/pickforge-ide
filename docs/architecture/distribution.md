# Distribution Strategy

Pickforge v0.1.0 ships through GitHub Releases: Linux `AppImage`/`.deb`/`.rpm`,
macOS arm64 `.dmg`/`.app`, and Windows `.msi`/NSIS installers. The in-app
updater is fed by a signed `latest.json`. Shipping unsigned binaries was an
accepted decision for v0.1.0; OS code signing, notarization, and a macOS x86_64
build are hardening gates for the next release.

## Update Channel

- In-app update checks use the build-time
  `PICKFORGE_UPDATE_METADATA_URL` endpoint documented in
  `docs/architecture/update-checks.md`.
- The metadata endpoint should point users to the selected package or release
  page for their platform.
- The updater reads the signed `latest.json` feed; auto-installing updates
  stays platform-specific and gated by OS code signing.

## macOS

- v0.1.0 ships an unsigned arm64 `.dmg`/`.app`. Signing, notarization, and an
  x86_64 build are next-release hardening gates.
- Use Sparkle 2 for automatic app updates after signing, notarization, and an
  HTTPS appcast are available.
- Keep Sparkle disabled until the appcast, EdDSA keys, release notes, and
  rollback process pass the runbook in `docs/architecture/sparkle-updates.md`.
- Validate appcast metadata with `scripts/macos_sparkle_appcast_smoke.sh` before
  publishing an update feed.
- Native validation requires a macOS host with Xcode, the Apple Developer ID
  certificate, notarization credentials, and Gatekeeper checks.

## Windows

- Prefer package-manager distribution first: `winget` manifest and optional
  Scoop bucket.
- v0.1.0 ships unsigned `.msi`/NSIS installers with the in-app updater feed.
- Authenticode signing and rollback are next-release hardening gates.
- Native validation requires a Windows host that can install the release
  artifact, run SmartScreen reputation checks, and verify PATH/tool discovery.

## Linux

- Linux releases publish AppImage, `.deb`, and `.rpm` artifacts from the Tauri
  release workflow. The curl installer stays rootless by default with an
  AppImage wrapper that falls back to `APPIMAGE_EXTRACT_AND_RUN=1` on FUSE3-only
  hosts. Users can opt into native packages with `PICKFORGE_INSTALL_KIND=deb` or
  `PICKFORGE_INSTALL_KIND=rpm`.
- Build Linux release artifacts on an Ubuntu runner so `.deb` binaries do not
  pick up a newer glibc requirement from a rolling local workstation.
- Run `scripts/linux_deb_container_install_smoke.sh --skip-build` after
  packaging to install the `.deb` in a clean Ubuntu 24.04 container and verify
  package metadata, installed files, dynamic linkage, and first-run liveness.
- After installing the package on a visible Linux desktop host, run
  `scripts/linux_installed_visible_smoke.sh` to launch `/usr/bin/pickforge` with
  a clean HOME and record post-install window, log, and screenshot evidence.
- Sign `.deb` artifacts with `scripts/sign_linux_deb.sh`, which emits detached
  ASCII-armored signatures for both the package and checksum. Release CI imports
  `PICKFORGE_GPG_PRIVATE_KEY_BASE64` only when that secret is present; local and
  PR builds remain unsigned.
- Treat Flathub as the preferred long-term store channel; Snap is secondary and
  only worth adding if users ask for it.
- Package metadata must include desktop entry, icon, executable name, license,
  and update/check URL behavior. The AppImage curl path also writes a user-scope
  `dev.pickforge.app.desktop`, points it at the FUSE-aware wrapper, extracts the
  AppImage icon into the hicolor theme, refreshes desktop/icon caches, and
  disables known stale user launchers.
- Package signing is a next-release hardening gate; v0.1.0 shipped unsigned by
  decision.

## Signing And Secrets

- CI should not attempt signing unless release secrets are present.
- Linux release signing requires `PICKFORGE_GPG_PRIVATE_KEY_BASE64`, optional
  `PICKFORGE_GPG_PASSPHRASE`, and optional `PICKFORGE_GPG_KEY`.
- Signing jobs must run only for protected tags.
- Local and PR builds remain unsigned.
- Release artifacts must record commit SHA, tag, workflow run, and platform in
  diagnostics build metadata.

## Release Gates

- Linux visible dogfood and cold-install artifact pass.
- macOS build, signing, notarization, launch, and Gatekeeper pass on native
  macOS.
- Windows build, signing, install, launch, and SmartScreen review on native
  Windows.
- Update-check endpoint returns valid metadata for the tagged version.
- Rollback instructions exist before enabling automatic update installation.

Remaining next-release hardening blockers are tracked in
`docs/release-blockers.md`.
