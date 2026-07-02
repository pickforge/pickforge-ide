# Plan 002 — Agent Chat GUI (Claude Code + Codex, structured chat)

Status: **v1+v2 implemented (2026-07-02), v3 pending** — added since draft: per-turn/session cost estimates, Settings default chat mode (terminal/agent/ask) + engine (v1/v2) · Created 2026-07-02 · Depends on: nothing (additive to workbench)

Goal: a chat surface in the workbench for talking to Claude Code and Codex without the terminal — bubbles for text, collapsible thought streams, cards for tool usage / shell commands / file changes, inline approval buttons, resumable sessions. Three phases: v1 proves the pipe on the stable CLI surfaces, v2 goes interactive on the rich protocols, v3 visualizes multi-agent orchestration.

## Project invariants (must follow)

- Core logic in `crates/pickforge-core`; `src-tauri` is a thin adapter layer (per AGENTS.md).
- UI: SolidJS, tokens-only styling (`src/styles/tokens.css`), Geist/Geist Mono, one ember accent. New UI needs VRT coverage.
- High-volume streaming uses Tauri `Channel` (match `pty_commands.rs` / `logcat_commands.rs`); `app.emit` only for low-volume status.
- IPC wrappers in `src/lib/`, stores in `src/stores/`, no inline `invoke` in components.
- SQLite via `rusqlite` in `pickforge-core/src/db/`; additive migrations only.
- Validation gate: `bun run build`, `cargo check`, `cargo test -p pickforge-core`, `bun run vrt`.

## Decisions (locked)

| # | Decision | Why |
|---|---|---|
| D1 | Structured chat is a **new chat kind** alongside PTY terminal chats, in the same projects/chats tree | Reuse `chatSessions`/`chatActivity` UX; terminal stays for people who want it |
| D2 | Codex v1 = `codex exec --json` (one process per turn, resume by thread id); Codex v2 = **`codex app-server` v2 JSON-RPC** over stdio, long-lived | exec's `ThreadEvent` schema is the stable surface; app-server is what VS Code ext/Desktop use and adds deltas, approvals, steer/interrupt, thread list |
| D3 | Claude v1 = `claude -p --output-format stream-json --include-partial-messages` per turn; Claude v2 = **Bun sidecar wrapping `@anthropic-ai/claude-agent-sdk`**, JSONL over stdio to Rust | Headless CLI cannot host a permission callback; the SDK's `canUseTool` is the only first-class approval hook. Bun is already the repo runtime |
| D4 | One **normalized `AgentEvent` model** defined in `pickforge-core`, provider streams mapped into it; frontend renders only normalized events | Two providers, three protocols, one renderer. Provider quirks stay in Rust |
| D5 | Auth stays with the CLIs: GUI never touches raw tokens. Codex login (v2) via `account/login/start` → open `authUrl`; Claude relies on existing `claude /login` state | Codex schema marks raw-token auth "internal use only"; Anthropic forbids third parties offering claude.ai login. Riding the user's own CLI auth is the documented-safe lane |
| D6 | Pin the Codex CLI version; CI runs `codex app-server generate-json-schema` against the pinned binary and diffs committed schemas | Codex releases every 1–3 days; generated artifacts are guaranteed to match the binary — churn becomes a visible diff, not a runtime break |
| D7 | Approval-less v1: Codex runs `--sandbox workspace-write` + `approval_policy=never`, Claude runs `--permission-mode acceptEdits` + explicit `--allowedTools` | Real isolation without mid-run prompts until v2 lands the approval UI |

## Distribution / ToS note

Personal use (driving your own logged-in CLIs) is within both vendors' documented usage. If Pickforge ships publicly: **BYO auth only** — detect the user's own CLI logins; never bundle credentials or offer a claude.ai login flow (Anthropic explicitly disallows that for third-party products; API-key mode is their sanctioned path). Codex app-server login endpoints are public protocol and fine to drive, since the CLI owns the tokens. OpenAI recommends API-key auth for CI-style automation; interactive personal use on plan auth is the documented norm.

## Normalized event model (D4)

`crates/pickforge-core/src/agents/event.rs` — `AgentEvent` enum, serde camelCase, tagged `kind`:

| AgentEvent | Codex exec `--json` | Codex app-server v2 | Claude stream-json / SDK |
|---|---|---|---|
| `TurnStarted` | `turn.started` | `turn/started` | `system:init` (first turn) / message_start |
| `TextDelta` / `TextFinal` | `item.completed: agent_message` (final only) | `item/agentMessage/delta` + `item/completed` | `stream_event: content_block_delta text_delta` + assistant message |
| `ThinkingDelta` / `ThinkingFinal` | `item.*: reasoning` (summary text) | `item/reasoning/textDelta`, `summaryTextDelta` | `thinking_delta` deltas + thinking blocks |
| `CommandStarted/Output/Done` | `item.*: command_execution` (aggregated) | `item/commandExecution/outputDelta` + status/exitCode | `tool_use Bash` + `tool_result` |
| `FileChange` (path, kind, diff) | `item.*: file_change` (no diff) | `fileChange` item (has `diff`) | `tool_use Edit/Write` input |
| `McpToolCall` | `item.*: mcp_tool_call` | `mcpToolCall` item + progress | `tool_use mcp__*` + result |
| `WebSearch` | `item.*: web_search` | `webSearch` item | `tool_use WebSearch/WebFetch` |
| `Todo/Plan` | `item.*: todo_list` | `plan` item, `turn/plan/updated` | TaskCreate/TodoWrite tool_use |
| `ApprovalRequest(id, kind, detail)` | — (v1 has none) | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | `canUseTool` callback (via sidecar) |
| `Usage` | `turn.completed.usage` | `thread/tokenUsage/updated` | `result.total_cost_usd` + usage |
| `TurnDone(status)` / `TurnFailed(err)` | `turn.completed` / `turn.failed` / `error` | `turn/completed.status` / `error` | `result` subtype success/error_* |
| `SessionStarted(provider_session_id)` | `thread.started.thread_id` | `thread/started` | `system:init.session_id` |

Parser rule (learned in testing): provider stdout is *not* guaranteed pure JSONL — stray log lines appear (e.g. MCP auth errors). Match by parsed event type; non-JSON lines become `AgentEvent::Noise` (logged, not rendered).

## Architecture / file map

```text
crates/pickforge-core/src/agents/
  mod.rs            registry: AgentSessionManager (id → running session, provider, chat id)
  event.rs          AgentEvent + serde tests
  session.rs        AgentSession trait: send_turn, interrupt, approve(id, decision), events()
  codex_exec.rs     v1: spawn codex exec --json / exec resume <id>, parse ThreadEvent
  codex_app.rs      v2: app-server client — spawn, initialize handshake, JSON-RPC id map,
                    thread/start|resume, turn/start|interrupt|steer, approval responses
  claude_stream.rs  v1: spawn claude -p --output-format stream-json --include-partial-messages
                    [--resume <id>], parse events
  claude_bridge.rs  v2: spawn bun sidecar (scripts/claude-bridge.ts), JSONL request/response
  db.rs             migrations: agent_messages, agent_items, agent_sessions (chat_id,
                    provider, provider_session_id, model, status, created_at)

src-tauri/src/agent_chat_commands.rs
  agent_chat_start(chat_id, provider, opts, channel) -> session_id
  agent_chat_send(session_id, text)
  agent_chat_approve(session_id, approval_id, decision)
  agent_chat_interrupt(session_id)
  agent_chat_history(chat_id) / agent_chat_list_provider_sessions(provider, cwd)

scripts/claude-bridge.ts        (v2) Agent SDK host: query() with includePartialMessages,
                                canUseTool -> {type:"approvalRequest"} line out, awaits decision line in

src/lib/agentChat.ts            IPC wrapper (Channel<AgentEvent>), typed against event.rs
src/stores/agentChat.ts         per-chat message list, streaming buffers, approval queue
src/components/chat/
  ChatTimeline.tsx  ChatBubble.tsx  ThinkingBubble.tsx (collapsible, dim)
  CommandCard.tsx (cmd, cwd, exit code, output tail, expand)  FileChangeCard.tsx (diff view)
  McpCard.tsx  WebSearchCard.tsx  PlanCard.tsx (todo checklist)
  ApprovalPrompt.tsx (allow / allow-for-session / deny / cancel)
  TokenBadge.tsx (per-turn usage; rate limits in v3)
  Composer.tsx (input, model/effort picker from agentModels.ts, provider switch)
```

## Phase v1 — prove the pipe (stable surfaces, no mid-run approvals)

- [x] `event.rs` + `AgentEvent` serde round-trip tests
- [x] DB migration: `agent_sessions`, `agent_messages`, `agent_items` (+ index by chat)
- [x] `codex_exec.rs`: spawn per turn (`codex exec --json -o <tmp>`, resume via `codex exec resume <thread_id>`), parser + fixture tests. Record real JSONL into `fixtures/agents/codex-exec/*.jsonl`
- [x] `claude_stream.rs`: spawn per turn (`claude -p … --resume <session_id>`), parser + fixtures in `fixtures/agents/claude-stream/`
- [x] Session-id ledger: persist `provider_session_id` on `SessionStarted` **before** first render (survives crash; recovery documented from `~/.codex/sessions/…-<thread_id>.jsonl` and `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`)
- [x] `agent_chat_commands.rs` + `Channel<AgentEvent>` plumbing (copy PTY channel pattern)
- [x] Frontend: store, timeline, bubbles, ThinkingBubble, CommandCard, FileChangeCard (no diff in v1 for Codex — exec doesn't carry diffs; show paths/kinds), TokenBadge, Composer
- [x] New-chat flow: "Structured chat" option next to terminal chat; provider + model + effort from `agentModels.ts`; cwd = project root
- [x] Interrupt = kill child process; render `TurnFailed(interrupted)`
- [x] Safety defaults per D7 (hardcoded in runners); settings surface for overrides DEFERRED to v2 (belongs with the approvals UI)
- [x] Unit: parser fixtures; VRT: timeline with fixture-driven story states

Acceptance: send a prompt to each provider from the GUI, watch text stream (Claude) / items arrive (Codex), see a shell command card with exit code, close app, reopen, resume both conversations, send follow-up that proves context survived.

## Phase v2 — interactive (rich protocols, approvals, diffs)

- [x] `codex_app.rs`: long-lived `codex app-server` per project; `initialize` handshake (`clientInfo`, opt-out of unrendered notification classes); `thread/start|resume`; `turn/start` with per-turn `effort`/`sandboxPolicy`; delta events → `TextDelta`/`ThinkingDelta`/`CommandOutput` live streaming
- [x] Approvals: `item/commandExecution/requestApproval` + `item/fileChange/requestApproval` → `ApprovalPrompt` buttons → respond `accept | acceptForSession | decline | cancel`. Switch Codex default to `approval_policy=on-request`
- [x] `turn/interrupt` + `turn/steer` (steer = "add message while running" in the composer)
- [~] `thread/list` + `thread/read includeTurns` (client APIs done; import/browse history UI deferred to v3 ledger) → import/browse existing terminal-era Codex sessions in history view
- [~] `thread/tokenUsage/updated` → context meter DONE; rate-limits indicator deferred (payload stored, no UI) → live context-window meter; `account/rateLimits/read|updated` → plan-usage indicator
- [x] `scripts/claude-bridge.ts` (Bun + `@anthropic-ai/claude-agent-sdk`): `query()` with `includePartialMessages`, thinking enabled; `canUseTool` → approval round-trip over stdio; `resume`/`forkSession`; `listSessions`/`getSessionMessages` for history import
- [x] `claude_bridge.rs` + protocol tests (fixture transcripts)
- [x] FileChangeCard: real diff rendering (app-server `fileChange.diff`; Claude Edit old/new)
- [x] CI drift check (D6): pinned codex version, `generate-json-schema` diff job; SDK version pinned in package.json, changelog review on bump
- [~] Codex login UX (client API exists; UI flow deferred): if `account/read` says logged out → `account/login/start {type:"chatgpt"}` → open `authUrl`, listen `account/login/completed`

Acceptance: mid-turn approval prompt answered from the GUI changes agent behavior; streamed deltas render token-by-token for both providers; diff cards show real patches; kill the app mid-turn and resume the thread; usage meters live-update.

## Phase v3 — orchestration view (the differentiator)

- [ ] Multi-lane view: one conversation orchestrates N agent sessions (lanes = columns; e.g. Claude plans, Codex builders in parallel, reviewer lane) — mirrors the codex-fable workflow (`~/.claude/skills/codex-fable`)
- [ ] Thread ledger panel: task → provider session id → status (building / reviewing / fixing / done), backed by `agent_sessions`; gate chips for review status
- [ ] Cross-provider handoff: "send this diff to Claude for review" / "send findings back to builder thread" (Codex `turn/start` on the task's thread; Claude `resume`)
- [ ] Prompt templates: wire `assets/prompts/*-*.md.tmpl` into the composer as slash-style inserts
- [ ] Usage dashboard: per-provider token/cost aggregation from `Usage` events + Codex rate limits
- [ ] Session GC: archive/delete dead threads (Codex `thread/archive|delete`; Claude transcript cleanup) — mirrors the ledger-cleanup rule from the codex skill
- [ ] Workbench integration: inspector-to-agent dispatch (`WidgetTree`/`A11yTree` "ask agent") can target a structured chat lane, not just a PTY

Acceptance: run a real plan (3+ tasks) where a planner lane produces tasks, builder lanes execute on separate Codex threads, review gates surface findings, and the ledger reflects every thread id and status without touching a terminal.

## Risks / drift checks

- **Codex protocol churn** — app-server still `[experimental]`, releases every 1–3 days. Mitigation: D6 pinning + schema-diff CI; prefer v2-stable methods; handle `deprecationNotice`.
- **Claude SDK is v0.x** — semver but young; session APIs recently reworked (old `createSession` removed). Pin + changelog review on bump.
- **Thinking asymmetry** — Codex gives reasoning summaries, Claude full thinking deltas (when enabled). ThinkingBubble must degrade to hidden when a provider sends nothing.
- **Non-JSON noise on stdout** — verified real (MCP auth error mid-stream). Parsers must never assume clean JSONL.
- **Two sessions, one repo**: structured chats and PTY chats can both mutate a project. Sandbox defaults (D7) + visible cwd chip mitigate; no lock in v1.
- **`--bare`/settings interplay** (Claude): loading the user's skills/CLAUDE.md is *desired* here (it's their environment), so do not use `--bare`; document that GUI turns behave like their terminal turns.

## Validation

Per slice: `cargo test -p pickforge-core` (parsers, ledger), `bun run build`, `bun run vrt` for new components, manual acceptance script per phase above. Record fixtures from real runs before writing parsers (fixtures-first).

## References

- Codex exec events: `codex-rs/exec/src/exec_events.rs` · app-server: developers.openai.com/codex/app-server · config: developers.openai.com/codex/config-reference
- Generated types: `codex app-server generate-ts --out <dir>` / `generate-json-schema` (matches installed binary)
- Claude Agent SDK (TS): code.claude.com/docs/en/agent-sdk/typescript.md · sessions.md · permissions.md · streaming-output.md · headless.md
- Session stores: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl` · `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
