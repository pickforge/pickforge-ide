# Unreleased

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Linux curl installs now use a rootless AppImage wrapper that falls back when
  FUSE is missing, inaccessible, or likely restricted by WSL/container hosts.
- Linux curl installs can opt into native `.deb`/`.rpm` release packages with
  `PICKFORGE_INSTALL_KIND=deb` or `PICKFORGE_INSTALL_KIND=rpm`.
- AppImage installs now add the launcher icon, refresh desktop search/menu
  caches, and disable known stale PickForge launchers in the user's app menu.
- Linux curl installs no longer execute the downloaded AppImage during install
  just to populate the app menu icon.

## Internal/release changes

- Linux release CI now asks Tauri to publish AppImage, `.deb`, and `.rpm`
  artifacts.
- Native Linux packages now install the `pickforge` command name.
- Added installer smoke tests for AppImage desktop integration, stale launcher
  cleanup, native `.deb` selection, and zypper `.rpm` installs.
- Installer smoke tests now run in CI, and GitHub tokens are only sent to
  official GitHub API URLs.

## Validation

### Tested

- `bun run test:installer`
- `bun run e2e`
- `bun run test:unit`
- `bun run test:coverage`
- `bun run build`
- `bun run sidecar`
- `cargo check`
- `cargo test --workspace --locked --all-targets`
- Temp-HOME live AppImage installer smoke against GitHub release `v0.1.8`
- `desktop-file-validate` on generated AppImage desktop entries
- `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 bun run tauri build --bundles appimage,deb,rpm --no-sign`
- `sh -n scripts/install.sh`
- `git diff --check`

### Not tested yet

- Signed updater artifacts locally; signing still requires release secrets.
- Visible desktop app launch from the menu after install.

### Release blockers

- None known.
