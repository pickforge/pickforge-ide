// VRT-only fixture seeding live/attention state for the flat chat list
// scenario (#306 PR1, `flatChatList` flag). Mirrors installStudioUpdateFixture:
// only reachable from the VITE_PICKFORGE_VRT branch in index.tsx — dead code
// (and unused) in the shipped app. The chat ids match the extra rows
// tauriMock adds to SAMPLE_CHATS when `pickforge.vrt.flatChatListFixture` is
// set; `chatActivity`'s busy/attention are runtime-only state normally driven
// by live PTY/agent-turn events, so a static Chat fixture alone can't produce
// a needs-you or working row — this seeds that state directly.
import { agentTurnDone, agentTurnStarted } from "../stores/chatActivity";
import { FLAT_CHAT_LIST_NEEDS_YOU_ID, FLAT_CHAT_LIST_WORKING_ID } from "./tauriMock";

const FIXTURE_KEY = "pickforge.vrt.flatChatListFixture";

function enabled(): boolean {
  try {
    return localStorage.getItem(FIXTURE_KEY) === "1";
  } catch {
    return false;
  }
}

export function installFlatChatListFixture() {
  if (!enabled()) return;
  // Working: a turn in flight, never finished.
  agentTurnStarted(FLAT_CHAT_LIST_WORKING_ID);
  // Needs-you: a turn that finished while nothing was watching it — the same
  // path a real unseen turn completion takes (see chatActivity.agentTurnDone).
  agentTurnStarted(FLAT_CHAT_LIST_NEEDS_YOU_ID);
  agentTurnDone(FLAT_CHAT_LIST_NEEDS_YOU_ID);
}
