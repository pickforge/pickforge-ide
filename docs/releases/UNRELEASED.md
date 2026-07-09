# Unreleased

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Added Remote Host settings for starting the local daemon listener, issuing
  pairing codes, and toggling Tailscale SSH.
- Launching PickForge again now focuses the running window.

## Internal/release changes

- Migrated release CI to the shared `@pickforge/tauri-release` tooling and draft-only `latest.json` finalization.
- Added the `pickforged` daemon foundation with hashed-token pairing auth.
- Landed the per-project remote host backend for bindings, SSH probing, and remote detection; UI follows.
- Operator M1 core parser, dispatch, and audit landed dark behind the `operator` flag.
- Operator composer dock landed dark behind the `operator` flag.
- Landed accounts/auth wiring dark behind the `accounts` flag.

## Validation

### Tested

- Workflow YAML parse check:
  `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
- `pickforge.release.json` shape checked against `../pickgauge/pickforge.release.json`.

### Not tested yet

- App build.
- Installer or updater flow.
- Platform smoke checks.

### Release blockers

- None known.
