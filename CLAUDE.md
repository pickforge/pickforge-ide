# PickForge — instructions for Claude

The repository conventions live in [`AGENTS.md`](AGENTS.md) — read it first;
everything there applies to you.

## Agent models

The embedded terminal is shell-first (it spawns `$SHELL`, never an agent).
Quick-launch chips type agent commands pinned to fast models by default
(Claude → Haiku 4.5, Codex → GPT-5.3 Codex Spark) via
`src/lib/agentModels.ts` and the Settings → "Agent models" picker. Prefer these
(and GPT-5.4 Mini) for testing/dogfooding to keep runs cheap.
