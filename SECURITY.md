# Security Policy

## Reporting a vulnerability

Email **security@pickforge.dev** with a description of the issue, affected
versions, and steps to reproduce. Please do **not** open a public GitHub
issue for security reports.

## Response expectations

- Acknowledgement within **48 hours**.
- Best-effort patch timeline, communicated once triaged.
- Public credit in release notes unless you prefer otherwise.

## Scope

PickForge runs locally and never sends your code over the network. The main
threat model we care about:

- Malicious `.pickforge/` content crafted to subvert the user's agent session.
- Privilege escalation via spawned terminal / wrapper scripts.
- VM Service URL handling.

Out of scope: third-party agent CLIs (report those to their maintainers) and
your own project's `CLAUDE.md` / `AGENTS.md` content.

## Supported versions

The latest minor release is supported. Older minors receive security fixes
on a best-effort basis.
