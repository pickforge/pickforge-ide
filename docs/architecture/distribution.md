# Distribution Strategy

Pickforge release automation currently builds raw Flutter desktop artifacts on
Linux, macOS, and Windows. Public distribution needs packaging, signing, and
native-host dogfood before release signoff.

## Update Channel

- In-app update checks use the build-time
  `PICKFORGE_UPDATE_METADATA_URL` endpoint documented in
  `docs/architecture/update-checks.md`.
- The metadata endpoint should point users to the selected package or release
  page for their platform.
- Auto-installing updates is platform-specific and gated by signing.

## macOS

- Package as a signed and notarized `.dmg` or `.zip` containing the `.app`.
- Use Sparkle 2 for automatic app updates after signing, notarization, and an
  HTTPS appcast are available.
- Keep Sparkle disabled until the appcast, EdDSA keys, release notes, and
  rollback process are documented.
- Native validation requires a macOS host with Xcode, the Apple Developer ID
  certificate, notarization credentials, and Gatekeeper checks.

## Windows

- Prefer package-manager distribution first: `winget` manifest and optional
  Scoop bucket.
- Keep in-app self-update out of MVP unless Windows signing and rollback are
  ready.
- Public installers must be Authenticode-signed before release.
- Native validation requires a Windows host that can install the release
  artifact, run SmartScreen reputation checks, and verify PATH/tool discovery.

## Linux

- Ship an AppImage for broad desktop testing with
  `scripts/package_linux_appimage.sh`, then validate it with
  `scripts/linux_appimage_smoke.sh --skip-build`.
- Build a `.deb` package for Debian/Ubuntu users with
  `scripts/package_linux_deb.sh`.
- Build Linux release artifacts on Ubuntu 24.04 so `.deb` binaries do not pick
  up a newer glibc requirement from a rolling local workstation.
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
  and update/check URL behavior.
- Package signing is still required before public distribution.

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
