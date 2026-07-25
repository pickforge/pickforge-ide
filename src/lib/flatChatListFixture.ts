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
import {
  FLAT_CHAT_LIST_NEEDS_YOU_ID,
  FLAT_CHAT_LIST_NEEDS_YOU_ID_2,
  FLAT_CHAT_LIST_WORKING_ID,
  FLAT_CHAT_LIST_WORKING_ID_2,
} from "./tauriMock";

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

  if (!enabled(HEAVY_FIXTURE_KEY)) return;
  agentTurnStarted(FLAT_CHAT_LIST_NEEDS_YOU_ID_2);
  agentTurnDone(FLAT_CHAT_LIST_NEEDS_YOU_ID_2);
  agentTurnStarted(FLAT_CHAT_LIST_WORKING_ID_2);
}
