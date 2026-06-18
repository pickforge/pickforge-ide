# Update Checks

PickForge auto-updates via the **Tauri updater plugin** (`tauri-plugin-updater`).
On launch the app checks a GitHub Releases endpoint, verifies the download's
signature against an embedded public key, and offers a one-click install +
relaunch.

## How it works

- `src-tauri/tauri.conf.json` → `plugins.updater`:
  - `endpoints`: `https://github.com/pickforge/pickforge/releases/latest/download/latest.json`
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
   the artifacts, creates a draft GitHub Release, and uploads `latest.json`
   (`includeUpdaterJson: true`). Publish the release to ship the update.

If the secrets are absent the build still succeeds but produces unsigned
artifacts, and clients will reject the update — so set them before tagging.

## Privacy

The check is a single GET to the public releases endpoint. It sends no source,
prompts, screenshots, project paths, or user identifiers.
