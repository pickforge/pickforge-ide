# PickForge Operator

Operator is the local intent layer over PickForge's existing agent chat, swarm,
run-target, device, and selection surfaces. M0 froze the words, data boundaries,
threat model, and initial `OperatorIntent` contract. M1.5 bumps the current
contract to v2 for device/run execution.

## Vocabulary

| Word | Meaning |
| --- | --- |
| command | What the user typed or spoke: raw natural-language text plus its input channel. Commands are never executed; they are routed into an intent. |
| intent | A validated, typed `OperatorIntent`. This is the only thing the Operator ever executes. Routers propose; local validation and policy dispose. |
| run | One execution of an approved intent, with status, timeline, and an audit row. |
| lane | One worker within a multi-agent run. Swarms have 1-5 lanes. |
| approval | An explicit local UI decision that lets a gated intent proceed. Approvals are never given by a model and never by voice. |
| autonomy mode | Per-project and per-chat setting deciding which intents need approval: `readOnly`, `approveWrites`, `plan`, `auto`, or `bypass`. Most restrictive scope wins. |
| credit | Prepaid Pro balance consumed by hosted routing or hosted voice. The ledger is the server-side source of truth and is mirrored locally for display. |

## Router Proposals and Composed Intents

There are two JSON shapes at the routing boundary:

- A router proposal is `{ action, confidence, projectRef? }` only. This is the wire message
  any router may produce: deterministic local routing, BYO routing, or hosted
  routing. Its concrete type lands in M1/M2.5.
- A composed intent is the full `OperatorIntent` envelope. The local composer
  assembles it, stamps `id` and `provenance`, and attaches `projectRef`.

`OperatorIntent::from_json` and `parseOperatorIntent` validate composed or
stored intents: audit rows, local preview state, and later remote-host
re-validation per #144. Router output must never be fed to those parsers
directly. `confidence` is advisory for display and preview only; policy must
never use it to bypass approval, because a router could set it to `1.0`.

M2.5 adds `projectRef` to router proposals as an optional opaque natural-language
project hint. The local composer copies it into the envelope and local dispatch
resolves it exactly like chat references inside actions; routers still cannot
set `id`, `provenance`, approval, cost, or any execution policy field.

## Routing Ladder

Typed commands first go through the deterministic parser. When that parser says
`needsRouter`, a configured BYO router may propose one strict action locally via
Claude Code, Codex, or Ollama. Hosted routing (#133) is the later fallback for
eligible Pro users. If each step is unconfigured, unclear, invalid, or errors,
the dock returns the honest "didn't understand" state and nothing is dispatched.

## BYO Router Setup

BYO routing is dark behind the `operator` flag. Settings -> Operator router lets
the user choose Off, Claude Code, Codex, or Ollama and enter the model id for
that backend; Ollama defaults to `qwen2.5:3b` as a small local placeholder
recommendation, not a guarantee that the model is installed. Claude Code uses
`claude -p ... --output-format json --safe-mode --strict-mcp-config --tools ""
--permission-mode plan --no-session-persistence --model <model>` from a fresh
empty temp directory. Codex uses `codex exec --json --skip-git-repo-check --cd
<empty-dir> --sandbox read-only --ephemeral --ignore-rules --ignore-user-config
-m <model>` against that same isolated directory. Ollama posts to fixed loopback
`127.0.0.1:11434/api/generate`. Expected latency depends on the backend and
model: local small Ollama models should be seconds-scale, CLI backends include
process startup and provider latency.

Manual parity checks are available outside CI:

```sh
PICKFORGE_ROUTER_CLAUDE_MODEL=claude-haiku-4-5 \
PICKFORGE_ROUTER_CODEX_MODEL=gpt-5.5 \
PICKFORGE_ROUTER_OLLAMA_MODEL=qwen2.5:3b \
node scripts/router-parity.mjs
```

Set only the backends you want to test. The harness runs one command per action
family, prints each backend's proposal JSON, and summarizes whether proposed
action names match.

## Autonomy Modes

| Mode | Semantics |
| --- | --- |
| `readOnly` | Read/reversible intents may run. Anything with writes, spend, fanout, interruption, or external effects is denied. |
| `approveWrites` | Default. Read/reversible intents may run; spend/write intents require approval before dispatch. |
| `plan` | Operator composes a full intent chain as an editable step list. Nothing runs until the plan is approved. Approved steps execute in order and stop on first failure. |
| `auto` | Spend/write intents may run without per-action approval when they stay inside project scope, spend limits, and audit policy. |
| `bypass` | Explicit advanced setting. It is never the default and is never enabled by a hosted router. |

Cross-cutting rules:

- The active mode is always visible.
- Mode is scoped per project and per chat/session. The most restrictive active
  scope wins.
- Voice never escalates. Mode switches, plan approvals, and risky-action
  confirmations are UI or typed actions only.
- Intents carry provenance, `typed` or `voice`. Provenance is stamped locally by
  the composer, never trusted from a router.
- Policy may require confirmation for risky voice intents even in `auto`,
  because mishearing is an input-error class typed commands do not have.

## Data Boundaries

| Data class | Local-only | BYO router | Pro hosted |
| --- | --- | --- | --- |
| Command text, typed or transcribed | Stays local. | Sent to the user's own provider. | Sent to the hosted router. |
| Project and chat display names | Local. | Allowed after local routing redaction. | Allowed after local routing redaction: names only, never absolute paths. This is enforced by policy/redaction, not the intent schema. |
| Compact widget-tree serialization from semantic selection | Local. | Allowed. | Allowed, redacted to structure and labels. |
| Source code, file contents, diffs | Never leaves via the Operator. | Never leaves via the Operator. | Never leaves via the Operator. |
| Agent transcripts, screenshots, `.pickforge/` artifacts, support bundles | Never by default. Any expansion needs preview, redaction, and explicit opt-in. | Never by default. Any expansion needs preview, redaction, and explicit opt-in. | Never by default. Any expansion needs preview, redaction, and explicit opt-in. |
| Absolute paths, device serials, hostnames | Never leave through routing payloads. | Never leave through routing payloads. | Never leave through routing payloads. This is enforced by local policy/redaction at the routing layer, not by the intent schema. |
| Audio | Never leaves. Voice is transcribed locally by `whisper.cpp` in the free path. | Never leaves. Voice is transcribed locally by `whisper.cpp` in the free path. | Never leaves by default. Pro Realtime voice in M6 is the explicit, flagged exception. |
| Intent JSON, approvals, run outcomes | Local audit store only. | Local audit store only. | Local audit store only. Server-side hosted mode records billing metadata per routed command: action name, token counts, and cost, never payload fields. The command text the router saw is processed for routing and is not retained in the ledger. |

PickForge never attaches collected identifiers such as paths, serials, or
hostnames to routing requests; the user's own typed command text is sent
verbatim to the provider they configured.

Local-only mode must remain fully functional. With hosted routing disabled, typed
commands and local dictation still work through the deterministic parser.

## Threat Model

### Hosted Routing (Pro)

Assets:

- User command text and redacted routing context.
- Local projects, chats, selections, and agent surfaces.
- Pro credits and billing metadata.
- Local audit trail.

Trust boundary:

- The hosted Edge Function router may see the allowed routing payload for one
  command and may propose an intent. It is outside the local execution boundary.

Threats:

- A compromised or malicious router returns harmful or mismatched intents.
- The router over-collects user data.
- An old routed proposal is replayed.
- Hosted routing is abused for cost.

Mitigations:

- Router output is data, not code. Local code applies strict schema validation,
  an action allowlist, and unknown action or field rejection.
- Local policy computes approval requirements and cost. Approval and cost are
  not wire fields and cannot be set by the router.
- Autonomy gates and provenance rules apply after validation.
- Replayed proposals gain no authority. The composer stamps a fresh local id and
  provenance, and the resulting intent re-enters approval and audit.
- Every intent gets an audit row.
- Spend caps cover monthly spend, per-command spend, and max concurrent hosted
  runs.
- The server never receives code, paths, transcripts, screenshots, or other
  disallowed payload classes from the data-boundary table.

### BYO Routing

Assets:

- The user's own model credentials.
- Command text and allowed redacted routing context.
- The same local project, chat, selection, and audit surfaces used by hosted
  routing.

Trust boundary:

- BYO routers use the user's own Claude, Codex, Ollama, or similar provider
  through one `IntentRouter` interface. Their output crosses into PickForge only
  as a proposed intent.

Threats:

- Prompt injection through command text or widget labels steers the proposed
  action.
- A BYO provider proposes an intent that does not match the user's request.

Mitigations:

- BYO output gets zero extra trust versus hosted output.
- The same wire contract, strict validation, action allowlist, and local policy
  gates apply.
- The blast radius is "proposes a gated intent", never direct execution.

### Local Execution

Assets:

- Validated `OperatorIntent` values.
- Existing IPC and store seams for agent chat, swarm, run targets, and device
  commands.
- Local audit rows.

Trust boundary:

- The executor accepts only validated `OperatorIntent` values from the local
  composer/policy layer.

Threats:

- A router smuggles shell strings, file paths, or unsupported behavior into a
  payload.
- A dispatch runs before the audit row exists.
- `bypass` becomes a hidden or remote-controlled setting.

Mitigations:

- The v2 schema constrains shape: allowlisted actions and typed fields. It does
  not prove string content is safe. `projectRef`, `chat`, `run`, `device`,
  `target`, and `model` are opaque reference strings that the local executor must
  resolve against existing local entities such as the project list, chat list,
  run registry, device list, and target registry.
- Resolution, not the schema, prevents path or shell smuggling. Content-level
  enforcement is local policy after parsing.
- Every dispatch writes the audit row before side effects.
- `bypass` is local-user-only opt-in, never router-enabled and never default.

### Forward Note: Remote Hosts (#144)

Assets:

- Per-project remote host access.
- Remote project files and execution surfaces.
- The local seat's validated intent.

Trust boundary:

- When per-project remote lands, intents gain a host dimension, such as "run it
  on the mac mini". SSH is the single remote transport.

Threats:

- A compromised local seat tries to turn an allowed local action into arbitrary
  remote code execution.
- A remote transport accepts an intent the local executor would reject.

Mitigations:

- The remote host re-validates the intent with the same schema and allowlist
  before executing.
- A compromised local seat does not get code execution on a remote host beyond
  what the allowlist grants.

## v2 Intent Allowlist

Risk tiers:

- Tier 0, read/reversible: runs without approval in every mode except where
  `readOnly` forbids side effects.
- Tier 1, spend/write: needs approval in `approveWrites`; auto-runs in `auto`
  unless provenance is `voice` and policy requires confirmation.
- Tier 2, external/destructive: git pushes, PR actions, account changes, and
  billing changes. Tier 2 is intentionally empty in v2 and is not representable
  in the schema.
- Rust `RiskTier::Read` equals TS `0`; Rust `RiskTier::SpendWrite` equals TS
  `1`.

| Action | Milestone | Payload summary | Risk tier |
| --- | --- | --- | --- |
| `openProject` | M1 core | Uses the envelope `projectRef`. If `projectRef` is `null`, M1 defines whether that means current/last project or requires disambiguation. | Tier 0 |
| `openChat` | M1 core | Optional chat reference. | Tier 0 |
| `createChat` | M1 core | Provider is `claude` or `codex` only, plus optional model. Other agent providers such as Ollama chats are a future version bump. BYO routing may use any provider; that is the router, not this field. | Tier 1 |
| `sendPrompt` | M1 core | Non-empty prompt and optional chat reference. | Tier 1 |
| `startSwarm` | M1 core | Scout/review mode, 1-5 lanes, non-empty goal, provider. | Tier 1 |
| `swarmStatus` | M1 core | No payload. | Tier 0 |
| `interruptRun` | M1 core | Optional run reference. Interrupt is tier 1 because it destroys in-flight paid work. | Tier 1 |
| `steerRun` | M1 core | Optional run reference and non-empty instruction. | Tier 1 |
| `launchEmulator` | M1.5 device-run | Optional device reference. Issue vocabulary for `selectDevice` maps to `launchEmulator { device }` instead of adding a duplicate action. | Tier 0 |
| `launchRun` | M1.5 device-run | Optional target reference. | Tier 0 |
| `reloadRun` | M1.5 device-run | No payload. | Tier 0 |
| `stopRun` | M1.5 device-run | No payload. Stops the active run-console run. | Tier 0 |
| `hotRestart` | M1.5 device-run | No payload. Full restart of the active run. | Tier 0 |
| `enterSelectMode` | M1.5 device-run | No payload. | Tier 0 |
| `takeScreenshot` | M1.5 device-run | No payload. Issue vocabulary for `deviceScreenshot` maps here instead of adding a duplicate action. | Tier 0 |
| `selectWidget` | M1.6 semantic selection | Non-empty widget description. | Tier 0 |

## Versioning and Contract

- The envelope carries literal `v: 2`.
- Stored `v: 1` envelopes are accepted only through the version translator and
  are normalized to v2 on read. The v1 action set remains strict, so v1 envelopes
  cannot contain v2-only actions such as `stopRun` or `hotRestart`.
- Parsers are strict. Unknown `v`, unknown action name, unknown or extra fields,
  and out-of-range values are rejected as typed errors and never partially
  accepted.
- The canonical serialized form includes optional fields with `null` when empty.
  Producers should not omit optional keys in stored or audited JSON.
- Canonical JSON uses integer tokens for `v` and `count`. The Rust parser is
  strict about this and rejects `3.0`; the TS parser cannot distinguish `3`
  from `3.0` after `JSON.parse`, so producers must emit integer tokens.
- Parse-error shapes are language-local: Rust exposes a typed enum and TS returns
  zod messages. Only the accept/reject contract is shared.
- Any addition, whether a new action or a new field, bumps `v`.
- Version translators upgrade old stored intents on read. Audit rows keep the
  original JSON.
- Rationale: intents are a security boundary. Forward-compatible leniency is the
  wrong default. Revisit at M2.5 if BYO router ergonomics demand additive
  tolerance.
