# PickForge IDE retirement runbook

Owner: Elberte. Run these steps only after the retirement PR is merged. Do not let the successor repository take `pickforge/pickforge` until the canonical-manifest step below is complete.

## 1. Prepare v0.2.1

The updater private key stays in the GitHub Actions secret at `pickforge/pickforge` → Settings → Secrets and variables → Actions → `TAURI_SIGNING_PRIVATE_KEY`. Its password is in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Do not print or copy either value locally.

```bash
cd /home/dev/Projects/Pickforge/pickforge
git switch main
git pull --ff-only origin main
git status --short
test "$(node -p "require('./package.json').version")" = "0.2.1"
test "$(node -p "require('./src-tauri/tauri.conf.json').version")" = "0.2.1"
test "$(grep -m1 '^version = ' Cargo.toml | cut -d '"' -f2)" = "0.2.1"
bun install --frozen-lockfile
bun run pickforge-tauri-release validate-config
gh secret list --repo pickforge/pickforge | grep -E '^TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?[[:space:]]'
```

The last command must show both secret names. It must not show secret values.

Create the same annotated release tag style used for v0.2.0:

```bash
git tag -a v0.2.1 -m "pickforge v0.2.1"
git push origin v0.2.1
```

The tag starts `.github/workflows/release.yml`. CI creates a draft release, builds the platform bundles, signs updater artifacts from the two Actions secrets, collects them with `@pickforge/tauri-release`, and generates `latest.json`.

```bash
RUN_ID="$(gh run list --repo pickforge/pickforge --workflow release.yml --commit "$(git rev-parse 'v0.2.1^{}')" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$RUN_ID"
gh run watch "$RUN_ID" --repo pickforge/pickforge --exit-status
gh release view v0.2.1 --repo pickforge/pickforge --json isDraft,tagName,url
```

## 2. Verify and publish the release

Download the draft assets without exposing signing material:

```bash
VERIFY_DIR="$(mktemp -d)"
gh release download v0.2.1 --repo pickforge/pickforge --dir "$VERIFY_DIR"
bun run pickforge-tauri-release verify-latest-json --input "$VERIFY_DIR/latest.json"
jq -e '.version == "0.2.1" and (.platforms | length > 0)' "$VERIFY_DIR/latest.json"
find "$VERIFY_DIR" -maxdepth 1 -type f -name '*.sig' -print
jq -r '.platforms[].url' "$VERIFY_DIR/latest.json" | while IFS= read -r url; do curl --fail --location --head "$url"; done
rm -rf "$VERIFY_DIR"
```

Stop if there are no `.sig` files, manifest verification fails, or any asset URL fails. Inspect the draft assets and release note, then publish:

```bash
gh release edit v0.2.1 \
  --repo pickforge/pickforge \
  --title "PickForge v0.2.1" \
  --notes-file docs/releases/v0.2.1.md \
  --draft=false
gh release view v0.2.1 --repo pickforge/pickforge --json isDraft,publishedAt,url
curl --fail --location --silent --show-error \
  https://github.com/pickforge/pickforge/releases/latest/download/latest.json \
  | jq -e '.version == "0.2.1"'
```

## 3. Verify the v0.2.0 update before the rename

If a v0.2.0 installation is available, launch it while `pickforge/pickforge` still has that name. Confirm that it offers v0.2.1, downloads it, verifies the signature, installs it, relaunches as v0.2.1, and shows the retirement notice. Confirm both notice links and dismissal. Relaunch once more and confirm the dismissed notice stays dismissed.

If no v0.2.0 installation is available, record that gap. Do not replace it with a release build or local signing run. The endpoint and asset checks above are the minimum fallback evidence.

## 4. Rename, canonicalize the manifest, and archive

The release workflow initially writes old-repository asset URLs so the pre-rename v0.2.0 smoke can complete. GitHub carries the release across the rename, but the old path will eventually belong to the successor. Immediately after renaming, regenerate `latest.json` so both the v0.2.1 endpoint and every URL inside its manifest use `pickforge/pickforge-ide` explicitly.

```bash
gh repo rename pickforge-ide --repo pickforge/pickforge --yes
gh repo view pickforge/pickforge-ide --json nameWithOwner,isArchived,url

MANIFEST_DIR="$(mktemp -d)"
mkdir -p "$MANIFEST_DIR/assets"
gh release download v0.2.1 --repo pickforge/pickforge-ide --dir "$MANIFEST_DIR/assets"
rm "$MANIFEST_DIR/assets/latest.json"
bun run pickforge-tauri-release generate-latest-json \
  --assets-dir "$MANIFEST_DIR/assets" \
  --version 0.2.1 \
  --download-base-url https://github.com/pickforge/pickforge-ide/releases/download/v0.2.1 \
  --out "$MANIFEST_DIR/latest.json"
bun run pickforge-tauri-release verify-latest-json --input "$MANIFEST_DIR/latest.json"
jq -e '
  .version == "0.2.1" and
  ([.platforms[].url | startswith("https://github.com/pickforge/pickforge-ide/releases/download/v0.2.1/")] | all)
' "$MANIFEST_DIR/latest.json"
gh release upload v0.2.1 "$MANIFEST_DIR/latest.json" --repo pickforge/pickforge-ide --clobber
curl --fail --location --silent --show-error \
  https://github.com/pickforge/pickforge-ide/releases/latest/download/latest.json \
  --output "$MANIFEST_DIR/published-latest.json"
bun run pickforge-tauri-release verify-latest-json --input "$MANIFEST_DIR/published-latest.json"
cmp "$MANIFEST_DIR/latest.json" "$MANIFEST_DIR/published-latest.json"
jq -r '.platforms[].url' "$MANIFEST_DIR/published-latest.json" | while IFS= read -r url; do curl --fail --location --head "$url"; done
rm -rf "$MANIFEST_DIR"

gh repo archive pickforge/pickforge-ide --yes
gh repo view pickforge/pickforge-ide --json nameWithOwner,isArchived,url
```

Do not archive if the canonical endpoint, manifest comparison, or asset checks fail.

## 5. Site handoff

Hand the live v0.2.1 and archived-repository URLs to the prepared `pickforge/landing-page` pivot PR. That PR must remove the IDE download/install call to action, point the product name to the successor at `https://pickforge.dev`, and leave no site-owned updater manifest for the IDE. Review and merge it through its own runbook only after its checks are green.

```bash
gh pr list --repo pickforge/landing-page --state open \
  --json number,title,headRefName,url,statusCheckRollup
```

Before the successor takes the old `pickforge/pickforge` path, make this a release invariant: successor releases must never contain an asset named `latest.json`. Legacy v0.2.0 installs still request that exact filename. A 404 is safe; a successor manifest is not.

## If v0.2.0 fetched a manifest from the wrong repository

A startup check only fetches metadata. It does not download or execute an update until the user chooses to install it, and a downloaded updater artifact must still pass the IDE's embedded signature check.

1. Quit the v0.2.0 app immediately. This clears its in-memory pending update. Do not click Update.
2. Remove the accidental `latest.json` asset from the successor's latest release:

   ```bash
   WRONG_TAG="$(gh release view --repo pickforge/pickforge --json tagName --jq .tagName)"
   gh release delete-asset "$WRONG_TAG" latest.json --repo pickforge/pickforge --yes
   curl --fail --location --silent --show-error \
     https://github.com/pickforge/pickforge/releases/latest/download/latest.json
   ```

   The final `curl` must fail. If it returns JSON, stop and find the remaining asset before launching v0.2.0 again.
3. Download v0.2.1 directly from `https://github.com/pickforge/pickforge-ide/releases/tag/v0.2.1` and install the package for that machine manually.
4. Relaunch and confirm the installed version is v0.2.1 and the retirement notice appears.
5. If the user already clicked Update, preserve the error shown by the signature check, quit, and manually install v0.2.1. If anything other than the IDE was installed, stop and investigate before reopening the existing PickForge data directory.

## Final verification checklist

- [ ] v0.2.1 tag points at the reviewed merge commit.
- [ ] Release workflow is green and both updater signing secret names were present.
- [ ] v0.2.1 is published with `docs/releases/v0.2.1.md` as its note.
- [ ] `latest.json` reports v0.2.1 and passes `verify-latest-json`.
- [ ] Every final manifest URL starts with `https://github.com/pickforge/pickforge-ide/` and downloads successfully.
- [ ] A v0.2.0 update smoke passed, or the missing-install gap was recorded.
- [ ] The updated app relaunches as v0.2.1 and shows the retirement notice once.
- [ ] `pickforge/pickforge-ide` is archived and read-only.
- [ ] The successor's `pickforge/pickforge` releases do not expose `latest.json`.
- [ ] The landing-page retirement/pivot PR was handed the final URLs and merged only with green checks.
