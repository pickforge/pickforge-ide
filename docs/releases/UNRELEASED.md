# Unreleased

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Added pinned agent plans so plan cards can be pinned from chat and resurfaced
  in the Orchestra ledger for the current project.

## Internal/release changes

- Added repo-local release tracking in `docs/releases/UNRELEASED.md`.

## Validation

### Tested

- Reviewed the release tracking docs.
- `bun run test:unit -- tests/unit/agentChat.test.ts tests/unit/pinnedAgentPlans.test.ts`
- `bun run build`
- `bun run vrt`

### Not tested yet

- App build.
- Installer or updater flow.
- Platform smoke checks.

### Release blockers

- None known.
