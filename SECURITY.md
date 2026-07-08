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

PickForge runs locally and keeps your source on your machine — it never uploads
your code on its own. Three deliberate exceptions are worth naming:

- On startup it checks GitHub Releases for an update (version metadata only — no
  source leaves your machine).
- Release builds send anonymous crash and error reports by default. Reports can
  include crash stack traces, error messages, OS details, app version, loaded
  system libraries, and native crash dumps. PickForge strips hostnames and
  breadcrumbs, and never intentionally adds file contents or terminal data, but
  crash dumps can contain fragments of process memory at crash time. You can
  turn this off in Settings → Crash reports.
- When you explicitly forge context to an agent, it launches a third-party CLI
  (Claude Code, Codex, OpenCode, …) with the widget context and screenshots you
  selected; that agent then talks to its own provider under your credentials.

The main threat model we care about:

- Malicious `.pickforge/` content crafted to subvert the user's agent session.
- Privilege escalation via spawned terminal / wrapper scripts.
- VM Service URL handling.

Out of scope: third-party agent CLIs (report those to their maintainers) and
your own project's `CLAUDE.md` / `AGENTS.md` content.

## Supported versions

The latest minor release is supported. Older minors receive security fixes
on a best-effort basis.
