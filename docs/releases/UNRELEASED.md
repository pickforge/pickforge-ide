# Unreleased — v0.2.1 candidate

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- The Codex agent-model picker now merges live-discovered models (`codex
  debug models --bundled`) with the curated static table, so new Codex
  releases can show up without a PickForge update. Curated entries keep
  their hand-tuned labels/effort levels; a probe failure falls back to the
  curated table only. Claude Code has no stable model-listing command, so
  its picker stays the curated static table. Quick-launch chips are
  unaffected — they still pin the curated cheap-model defaults.
- OMP (Oh My Pi) native chat is now enabled by default: model catalog in the
  composer picker, honest cancel with persisted interrupted turns, and
  connector diagnostics. The `ompAgents` flag remains as an off-switch.
- Claude Opus 5 replaces Opus 4.8 in the agent model picker, swarm model
  aliases, and cost estimates (same $5/$25 pricing; default effort high).
- Swarm commands no longer misread model version digits as lane counts
  ("/swarm of three opus 5 agents" now launches 3 lanes, not 5; same fix
  covers "sonnet 5" and "gpt-5.5").
- Pi native chat is now always available when compatible Pi is installed (>=0.79.10 and <0.82.0).
- Fixed OMP 17.1.1 native chat being incorrectly reported as unavailable.
- Stopped OMP turns now retain the user prompt, partial response, and interrupted status in chat history.

## Internal/release changes (dark: no default-on behavior change)

- Removed the `piAgents` flag after Pi native chat shipped default-on in v0.2.0.
- Settings shell (behind the default-off `settingsNavigation` flag, #211 PR 3):
  section titles inside the content pane are now real headings (h2, with h3
  for sub-groups like Connector diagnostics and Danger zone) instead of
  unlabeled text, so assistive tech can navigate by heading; added focused
  keyboard-nav/persistence unit tests and a reduced-motion VRT check for the
  category rail.

## Validation

### Not tested yet — release gates

### Known limits

- Pi native chat requires Pi >=0.79.10 and <0.82.0.
- OMP native chat requires OMP >=17.1.1 and <18.0.0 and remains behind the default-off `ompAgents` flag pending #284 and #285.
