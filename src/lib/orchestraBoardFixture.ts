// VRT-only fixture seeding live/attention state for the orchestra board
// scenario (#319, #196 PR1, `orchestraBoard` flag). Mirrors
// installFlatChatListFixture: only reachable from the VITE_PICKFORGE_VRT
// branch in index.tsx — dead code (and unused) in the shipped app. The
// board's tasks (ORCHESTRA_BOARD_FIXTURE_TASKS, tauriMock.ts) assign
// chat-1 as the "building" task's builder and chat-2 as the "fixing" task's
// builder; chatActivity's busy/attention are runtime-only state a static
// Chat/Task fixture alone can't produce, so this seeds it directly.
import { agentTurnDone, agentTurnStarted } from "../stores/chatActivity";

const FIXTURE_KEY = "pickforge.vrt.orchestraBoardFixture";

function enabled(): boolean {
  try {
    return localStorage.getItem(FIXTURE_KEY) === "1";
  } catch {
    return false;
  }
}

export function installOrchestraBoardFixture() {
  if (!enabled()) return;
  // Busy: a turn in flight, never finished — the "building" card's ember dot.
  agentTurnStarted("chat-1");
  // Needs-you: a turn that finished while nothing was watching it — the
  // "fixing" card's warning dot.
  agentTurnStarted("chat-2");
  agentTurnDone("chat-2");
}
