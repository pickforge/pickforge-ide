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
- Fixed macOS window rubber-banding and popover menus selecting a neighboring row near the bottom of the window.
- Terminal chats now use an honest terminal identity and icon instead of being labeled as Claude Code; existing falsely stamped terminal history is migrated automatically, the new-chat menu now shows terminal and harness marks, and a recognized harness running in a terminal chat under a raw pty appears transiently beside the terminal icon. Chats using the dtach or tmux recovery backend show the terminal icon alone.
- Fixed bypass-permissions mode breaking agent SDK sessions and leaving later sends stuck as working.
- The Source Control pane now has a single refresh button that refreshes both the repo status and the Changes review listing (the duplicate header button is gone).
- The chat composer's context-window and session-cost readout moved into the
  message box itself — tokens at its bottom-left, cost at its bottom-right, and
  the box's bottom edge doubling as the usage bar. It no longer floats loose
  beside the agent/model pickers or stack into three lines in a narrow pane, and
  the wider bar makes a small fraction of a large context window visible.
- Fixed flat-list work cards collapsing into clipped one-line pills when the sidebar pane is short (e.g. Files section expanded); the list now scrolls, which also stops rows shifting under the cursor and eating clicks.
- The sidebar chat list no longer lets the browser silently re-scroll it when a
  chat is promoted to a live card above the fold. Applies to Chromium-based
  webviews (Windows/WebView2) today; WebKit does not implement scroll anchoring
  until Safari 27, so this is prevention rather than a fix there. macOS builds
  were never affected by this mechanism — the transient pane clipping reported
  in #356 has a different, still-unidentified cause on WKWebView.
- The chat now follows a turn all the way to its end. A streaming reply no longer
  reserves a screen of empty space below itself, and the turn's closing token/cost
  row is no longer left just below the fold — the view stopped following at the
  moment the reserved space collapsed.
- Shift+Enter in the composer now opens a visible new line on the first press
  (it used to take two), and the caret stays in view as a long draft grows.
- Chat timeline rows are tighter: collapsed command, tool, and thinking rows take
  the height they actually need instead of a 48px minimum, and the gap between
  rows is smaller, so an agent run reads as a log rather than a list of cards.
- Numbered lists in chat messages no longer push their "10." markers into the
  message bubble's edge.
- `AskUserQuestion` is answerable. A Claude agent asking you to choose between
  options used to render as a bare "TOOL AskUserQuestion" Allow/Deny prompt,
  and pressing Allow made the agent report that you had declined to answer and
  continue on invented defaults. It now renders the real questions and options,
  sends your actual answers back, and "Allow for session" can no longer
  auto-answer a later question with a stale reply.
- Chat timeline spacing is now run-aware: a burst of CMD/TOOL/MCP/web rows sits
  tight as one block, while prose keeps the wider "new thought" distance either
  side of it. Previously every pair was spaced identically, so nothing in the
  layout told a run of tool calls apart from a change of subject.
- Swarm run cards in chat and the pi-kit lanes panel now use the same
  expand/collapse motion and rotating chevron as the rest of the transcript,
  so every disclosure in the app behaves one way.
- Expanding a CMD, TOOL, MCP or WEB row in chat now eases open and closed with
  a chevron that turns, instead of the body popping into existence and
  everything below snapping down. THINKING already behaved this way, so the
  same gesture no longer had two different behaviours in one transcript.
  Reduced motion renders it instantly.

## Internal/release changes (dark: no default-on behavior change)

- Interrupting a turn with messages queued now says so: the dock re-voices as
  `[ HELD · n` with explicit Send and Discard, and the composer yields its
  accent to that decision (#357 PR 2). Retrying a dead connection holds the
  queue the same way, instead of leaving it to sit until some later turn
  happened to close (#369). Queued messages can now carry image attachments.
- On Pi, a message typed while a turn is running is now handed to that turn
  through the native follow-up RPC instead of waiting in the queue, so the
  agent can act on it inside the same run (#357 PR 2). Backends whose protocol
  has no equivalent still queue. A message carrying images, or a follow-up the
  RPC rejects, falls back to the queue rather than being lost.
- Message queue edge cases (behind the default-off `messageQueue` flag, #369):
  the entry currently being dispatched no longer offers a Remove control that
  silently does nothing — it takes the fill and bright text of the message it
  is about to become. Turning the flag off now stops new queuing without
  stranding entries already queued: they stay visible, removable, and still
  drain.
- Message queuing while an agent turn is running (behind the default-off
  `messageQueue` flag, #357 PR 1): typing and pressing Enter mid-turn now
  queues the message instead of being refused, on every native backend —
  previously Claude Code and OMP left the composer dead, and Codex and Pi
  only offered steering. Queued messages rack above the composer as unfilled
  ghosts of the bubbles they become, drain one at a time in FIFO order when
  the turn closes, and can be removed before they send. Interrupting holds
  the queue rather than firing it. A failed queued send surfaces the error
  and leaves the backlog intact.
- Corrected the design-system section of `AGENTS.md`, which pointed agents at
  a non-existent `src/styles/tokens.css`; tokens live in
  `@pickforge/brand/src/tokens.css` and are imported via `src/styles/global.css`.
- update-vrt-baselines now re-dispatches ci on the branch after committing regenerated PNGs (GITHUB_TOKEN pushes trigger no workflows), so PRs no longer strand at "no checks reported"; ci is manually dispatchable and its token is pinned read-only.
- The v2 SDK bridge now grants the skip-permissions capability at every spawn
  because its long-lived CLI process cannot gain that capability later;
  permissions are still bypassed only when the user explicitly selects bypass
  mode.
- Removed the `piAgents` flag after Pi native chat shipped default-on in v0.2.0.
- Fixed a race in the default-off `changesReview` re-fold (#368): a turn that
  started while the re-fold was fetching history had its just-sent message
  wiped from the timeline, because the commit replaced the timeline wholesale
  with history that predated the optimistic row. The re-fold now re-defers to
  the next terminal event instead of committing over a live turn.
- Fixed expanded runs collapsing on their own in the default-off `pikitLanes`
  panel (#363): the 4s poll replaced the run list with freshly deserialized
  objects, so `For` disposed and recreated every card. The store now diffs by
  run id, which also lets lane values update in place instead of remounting the
  row. Swarm run cards in chat had the same defect from their own store's
  per-update object rebuild and now key expansion by run id.
- The flat sidebar's project filter (behind the default-off `flatChatList`
  flag, #371) is now the app's one dropdown instead of a wrapping row of pill
  chips. The chips wrapped onto multiple rows and grew with every project —
  72px of fixed chrome against a 108px list viewport; the dropdown is 36px and
  leaves 144px. Project right-click options (rename, remote host, move to
  group, archive) moved onto the dropdown's option rows, so nothing is lost.
- Settings shell (behind the default-off `settingsNavigation` flag, #211 PR 3):
  section titles inside the content pane are now real headings (h2, with h3
  for sub-groups like Connector diagnostics and Danger zone) instead of
  unlabeled text, so assistive tech can navigate by heading; added focused
  keyboard-nav/persistence unit tests and a reduced-motion VRT check for the
  category rail.

## Validation

- `bun run test:unit`
- `bun run test:coverage`
- `bun run lint`
- `bun run build`
- `bunx playwright test tests/vrt/dropdown.spec.ts` (against an isolated VRT dev server)
- `cargo test -p pickforge-core`
- `cargo test --workspace --locked --all-targets`

### Not tested yet — release gates

- Terminal harness VRT was skipped because another checkout owns port 1420 and local macOS baselines are not CI-canonical.

### Known limits

- Pi native chat requires Pi >=0.79.10 and <0.82.0.
- OMP native chat requires OMP >=17.1.1 and <18.0.0 and remains behind the default-off `ompAgents` flag pending #284 and #285.
