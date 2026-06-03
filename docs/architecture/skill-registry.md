# Skill Registry and Trust Model

Pickforge currently supports bundled skills and project-local overrides in:

```text
<projectRoot>/.pickforge/skills/<skill-id>.md
```

Community skill packs should build on that local override mechanism instead of
introducing remote execution or hidden prompt sources.

## Scope

The first registry version should distribute markdown-only skills. It should not
run code, install binaries, store API keys, or grant agents any permissions they
do not already have through the active agent CLI session.

Phase 1 should support replacing bundled skill IDs:

- `edit-widget`
- `extract-widget`
- `explain-widget`

New dynamic skill IDs require a later model change because the current Forge
state uses the `SkillId` enum.

## Registry Index

A registry is a static JSON document fetched from a user-approved source. The
app should ship with no third-party registry enabled by default.

Example index entry:

```json
{
  "schemaVersion": 1,
  "skills": [
    {
      "id": "edit-widget",
      "name": "Edit Widget - Material Cleanup",
      "version": "1.0.0",
      "description": "A stricter edit-widget prompt for Material layout cleanup.",
      "license": "MIT",
      "sourceUrl": "https://example.com/pickforge/skills/material-cleanup",
      "archiveUrl": "https://example.com/pickforge/skills/material-cleanup-1.0.0.tar.gz",
      "sha256": "hex-encoded-archive-digest",
      "entrypoint": "skills/edit-widget.md"
    }
  ]
}
```

The registry client should treat all fields as untrusted display data except the
hash, which is used only after the user chooses to install a package.

## Install Flow

1. User adds a registry URL or imports a local registry file.
2. Pickforge lists matching skills with source URL, license, version, and
   whether the skill replaces a bundled skill.
3. User opens a preview of the markdown before install.
4. Pickforge downloads the archive, verifies `sha256`, extracts only markdown
   files, and refuses path traversal.
5. Pickforge writes the selected entrypoint to
   `.pickforge/skills/<skill-id>.md`.
6. The Forge panel source inspector shows the installed override path.

Uninstalling a community skill should delete the project-local override and
fall back to the bundled asset.

## Trust Model

- Skills are prompts, not plugins. Markdown is data; executable hooks are out of
  scope.
- Registry sources are opt-in and scoped to the local machine.
- Package install is explicit per project. No registry may auto-update project
  skills.
- Every install must show source URL, license, target skill ID, and the exact
  target path.
- Archive extraction must reject absolute paths, `..` segments, symlinks, hard
  links, and non-markdown payloads.
- The app should show a diff when replacing an existing project-local skill.
- The app should never store registry credentials or agent API keys.

## Future Hardening

Signed registry indexes can be added later with a pinned public key per
registry. That should be additive to hash verification, not a replacement for
it. If dynamic skill IDs are added, the skill picker should distinguish bundled,
project-local, and registry-installed skills using the same source inspector
surface.
