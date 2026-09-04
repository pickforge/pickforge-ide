# Update Checks

PickForge v0.2.1 is the final release. It uses the **Tauri updater plugin**
(`tauri-plugin-updater`) for the one last update from v0.2.0. On launch the app
checks a GitHub Releases endpoint, verifies the download's signature against an
embedded public key, and offers a one-click install + relaunch.

## How it works

- `src-tauri/tauri.conf.json` → `plugins.updater`:
  - `endpoints`: `https://github.com/pickforge/pickforge-ide/releases/latest/download/latest.json`
  - `pubkey`: the base64 minisign public key (safe to commit).
- `bundle.createUpdaterArtifacts: true` makes the bundler emit the signed
  updater artifacts (`*.sig`) alongside each installer.
- Frontend: `src/lib/updater.ts` (`checkForUpdate`, `installUpdate`). The header
  shows an **Update** badge when one is available; Settings → Updates has the
  full check / install flow. Checks are silent on failure and never block paint.

## Signing keys (required for releases)

Updates are signature-verified, so the CI must sign artifacts with the **private
key** that matches the `pubkey` in `tauri.conf.json`.

1. Generate a keypair (already done once for this repo's pubkey):
   ```bash
   bun run tauri signer generate -w pickforge-updater.key
   ```
   Keep the private key OUT of git. The matching public key is embedded in
   `tauri.conf.json`.
2. Add two GitHub repo secrets (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — the private key file's contents.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password (empty string if none).
3. Push a `v*` tag. `.github/workflows/release.yml` builds every platform, signs
   the artifacts, creates a draft GitHub Release, and generates `latest.json`
   with `@pickforge/tauri-release` from the collected signed assets. Publish the
   release to ship the update.

The final release is cut while the repository is still named
`pickforge/pickforge`, so its first manifest uses that repository's download
base and v0.2.0 can complete an update smoke. The repository rename carries the
release and assets with it. Before the old name is reused, follow `RUNBOOK.md`
to regenerate and replace `latest.json` with canonical `pickforge/pickforge-ide`
asset URLs. The release-tool config's `repository` field is metadata; the
explicit `--download-base-url` is what is written into each platform URL.

If the secrets are absent the build still succeeds but produces unsigned
artifacts, and clients will reject the update, so set them before tagging.

## Privacy

The check is a single GET to the public releases endpoint. It sends no source,
prompts, screenshots, project paths, or user identifiers.
