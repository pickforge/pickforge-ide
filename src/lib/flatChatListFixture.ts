// VRT-only fixture seeding live/attention state for the flat chat list
// scenario (#306 PR1, `flatChatList` flag). Mirrors installStudioUpdateFixture:
// only reachable from the VITE_PICKFORGE_VRT branch in index.tsx — dead code
// (and unused) in the shipped app. The chat ids match the extra rows
// tauriMock adds to SAMPLE_CHATS when `pickforge.vrt.flatChatListFixture` is
// set; `chatActivity`'s busy/attention are runtime-only state normally driven
// by live PTY/agent-turn events, so a static Chat fixture alone can't produce
// a needs-you or working row — this seeds that state directly.
import { agentTurnCleared, agentTurnDone, agentTurnStarted } from "../stores/chatActivity";
import { ensureAgentChat } from "../stores/agentChat";
import { setSelectedLanes } from "../stores/orchestra";
import { setOrchestraOpen } from "../stores/orchestraStage";
import { selectChat } from "../stores/workspace";
import {
  FLAT_CHAT_LIST_NEEDS_YOU_ID,
  FLAT_CHAT_LIST_NEEDS_YOU_ID_2,
  FLAT_CHAT_LIST_WORKING_ID,
  FLAT_CHAT_LIST_WORKING_ID_2,
} from "./tauriMock";

const NEEDS_YOU_PROJECT_ROOT = "/home/dev/widgets";
// A stable, always-present widgets chat (SAMPLE_CHATS, not gated by any
// fixture flag) to activate instead of the needs-you chat itself — keeps
// `workspace.activeRoot` on widgets (so isChatStaged looks up the right
// project) without making the needs-you chat the ACTIVE one, which would
// collapse the staged-only scenario into the already-covered active one.
const WIDGETS_QUIET_CHAT_ID = "chat-3";

const FIXTURE_KEY = "pickforge.vrt.flatChatListFixture";
const HEAVY_FIXTURE_KEY = "pickforge.vrt.flatChatListHeavyFixture";

function enabled(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function installFlatChatListFixture() {
  if (!enabled(FIXTURE_KEY)) return;
  // Working: a turn in flight, never finished.
  agentTurnStarted(FLAT_CHAT_LIST_WORKING_ID);
  // Needs-you: a turn that finished while nothing was watching it — the same
  // path a real unseen turn completion takes (see chatActivity.agentTurnDone).
  agentTurnStarted(FLAT_CHAT_LIST_NEEDS_YOU_ID);
  agentTurnDone(FLAT_CHAT_LIST_NEEDS_YOU_ID);
  // #306 PR2: headlessly warms the working chat's agent-chat store (same
  // mechanism swarm.ts's dispatchSwarm already uses for lane chats it never
  // opens a UI for) so its context edge + footer cost have real, nonzero
  // data — see FLAT_CHAT_LIST_WORKING_HISTORY in tauriMock.ts.
  void ensureAgentChat(FLAT_CHAT_LIST_WORKING_ID, "/home/dev/acme-app", "claudeCode", null);
  // #306 PR2 VRT hook: lets the linger-then-collapse spec end the working
  // chat's turn on demand — a static fixture can't drive a real 4s browser
  // timer transition at install time. No-op (and unreachable) outside VRT.
  (window as unknown as { __PICKFORGE_VRT_FINISH_WORKING_TURN__?: () => void }).__PICKFORGE_VRT_FINISH_WORKING_TURN__ =
    () => agentTurnCleared(FLAT_CHAT_LIST_WORKING_ID);
  // #306 PR2 P2 fix VRT hook: stages the needs-you chat as an orchestra lane
  // on demand, so the bracket-rule spec can assert the L-corners survive a
  // staged sub-state too (see FlatWorkCard's showBracket — state-only now,
  // no active/staged exception). No-op (and unreachable) outside VRT.
  (window as unknown as { __PICKFORGE_VRT_STAGE_NEEDS_YOU__?: () => void }).__PICKFORGE_VRT_STAGE_NEEDS_YOU__ =
    () => {
      // isChatStaged reads selectedLanes(workspace.activeRoot) — the needs-you
      // chat's own project must actually be the active one for staging it to
      // register. selectChat (not selectProject) sets activeRoot/activeChatId
      // synchronously with no DB round-trip, and activating a DIFFERENT
      // widgets chat first (rather than the needs-you chat itself) keeps this
      // a genuinely staged-but-not-active scenario.
      selectChat(WIDGETS_QUIET_CHAT_ID);
      setOrchestraOpen(true);
      setSelectedLanes(NEEDS_YOU_PROJECT_ROOT, [FLAT_CHAT_LIST_NEEDS_YOU_ID]);
    };

  if (!enabled(HEAVY_FIXTURE_KEY)) return;
  agentTurnStarted(FLAT_CHAT_LIST_NEEDS_YOU_ID_2);
  agentTurnDone(FLAT_CHAT_LIST_NEEDS_YOU_ID_2);
  agentTurnStarted(FLAT_CHAT_LIST_WORKING_ID_2);
}
