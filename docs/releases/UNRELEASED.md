# Unreleased — v0.2.1 candidate

Working draft for the next PickForge release. Keep this current while PRs land.
At release time, copy and polish it into the GitHub release description, then
reset this file.

## User-facing changes

- Pi native chat is now always available when compatible Pi is installed (>=0.79.10 and <0.82.0).
- Fixed OMP 17.1.1 native chat being incorrectly reported as unavailable.

## Internal/release changes (dark: no default-on behavior change)

- Removed the `piAgents` flag after Pi native chat shipped default-on in v0.2.0.

## Validation

### Not tested yet — release gates

### Known limits

- Pi native chat requires Pi >=0.79.10 and <0.82.0.
- OMP native chat requires OMP >=17.1.1 and <18.0.0 and remains behind the default-off `ompAgents` flag pending #284 and #285.
