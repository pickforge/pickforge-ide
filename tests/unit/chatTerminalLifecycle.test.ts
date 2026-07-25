// @vitest-environment jsdom
// @vitest-environment-options {"jsdom":{"customExportConditions":["browser"]}}
//
// Contract tests for the chat-terminal lifecycle coordinator (issue #220 PR 3):
// the choreography Workbench used to inline across its TerminalHost props now
// lives in chatTerminalLifecycle.ts. These tests exercise it against the REAL
// chatAutoName/chatActivity/terminalHosts modules (only workspace persistence
// and chat-archive membership are stubbed) so the ordering invariants are
// proven end-to-end, not against mocks of the thing under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

const archived = vi.hoisted(() => ({ ids: new Set<string>() }));
const db = vi.hoisted(() => ({ setChatSessionId: vi.fn() }));

vi.mock("../../src/stores/workspace", () => ({
  setChatSessionId: db.setChatSessionId,
  // chatAutoName reads these directly; a chat row with the default title is
  // enough for armChatAutoName/maybeAutoNameChat's own (separately tested)
  // logic to behave normally in this contract test.
  findChat: (id: string) => ({ chatId: id, title: "New chat", titleSource: "default" }),
  setChatTitle: vi.fn(async () => true),
  resumeAutomaticChatTitles: vi.fn(),
}));
vi.mock("../../src/stores/chatArchive", () => ({
  isChatArchived: (id: string) => archived.ids.has(id),
}));
vi.mock("../../src/lib/attentionSound", () => ({ playAttentionSound: vi.fn() }));
vi.mock("../../src/stores/flags", () => ({ flagEnabled: () => false }));
vi.mock("../../src/components/AskAiMenu", () => ({ AskAiMenu: () => null }));
vi.mock("../../src/components/Terminal", () => ({
  TerminalPane: (props: {
    chat?: { chatId: string; onSession?: (info: unknown) => void };
    onReady?: (h: { typeText: () => void; clear: () => void; focus: () => void }) => void;
  }) => {
    props.onReady?.({ typeText: vi.fn(), clear: vi.fn(), focus: vi.fn() });
    // The primary (session-backed) pane resolves its spawn and reports a
    // fresh session, exactly like the real TerminalPane does post-spawn.
    if (props.chat) {
      props.chat.onSession?.({ sessionId: "sid-1", backend: "dtach", degraded: false, attached: false });
    }
    return document.createElement("div");
  },
}));

import {
  chatTerminalHostBinding,
  disposeChatTerminalHostBinding,
} from "../../src/lib/chatTerminalLifecycle";
import { TerminalHost, type TerminalHostHandle } from "../../src/components/TerminalHost";
import { getTerminalHost } from "../../src/stores/terminalHosts";
import {
  armChatAutoName,
  chatHadAgentSession,
  hasAgentPane,
  isAgentPane,
} from "../../src/lib/chatAutoName";
import {
  CHAT_BUSY_QUIET_MS,
  chatAttention,
  chatBusy,
  setActiveChatForActivity,
  setWindowFocusForActivity,
} from "../../src/stores/chatActivity";

// Node 22+ ships a built-in (experimental) global `localStorage` that is a
// non-functional stub unless `--localstorage-file` is passed. jsdom's window
// has its own real implementation, but vitest's jsdom environment only copies
// window properties onto the global scope when the key isn't already present
// there — so on a host Node with the built-in global, the bare `localStorage`
// chatAutoName.ts reads resolves to Node's broken stub instead of jsdom's real
// one. Stand up a real, spec-equivalent Storage so the module's actual
// persistence code path (getItem/setItem/removeItem) runs for real, the same
// way it does under jsdom on hosts without the built-in global.
const storageValues = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  archived.ids.clear();
  db.setChatSessionId.mockClear();
  setWindowFocusForActivity(true);
  setActiveChatForActivity(null);
  storageValues.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => void storageValues.set(key, value),
    removeItem: (key: string) => void storageValues.delete(key),
    clear: () => storageValues.clear(),
    key: () => null,
    length: 0,
  } satisfies Storage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let chatCounter = 0;
function freshChatId(): string {
  return `chat-${++chatCounter}`;
}

describe("chatTerminalHostBinding — fresh attach vs. reattach ordering", () => {
  it("fresh (non-attached) session re-persists the agent flag when a chip launch beat the spawn report", () => {
    const chatId = freshChatId();
    const binding = chatTerminalHostBinding(chatId);
    const paneId = "pane-primary";

    // The chip/hotkey launch races ahead of the pane's async spawn report and
    // arms the pane as an agent BEFORE onSession ever fires for it.
    armChatAutoName(chatId, paneId);

    // Fresh spawn report: not attached (a brand-new session).
    binding.onSession({ sessionId: "sid-1", backend: "dtach", degraded: false, attached: false }, paneId);

    // Clearing-then-re-deriving must land the flag SET (an agent really is
    // running in this fresh pane) — reversing the order would leave it wiped.
    expect(chatHadAgentSession(chatId)).toBe(true);
    expect(isAgentPane(chatId, paneId)).toBe(true);
    expect(db.setChatSessionId).toHaveBeenCalledWith(chatId, "sid-1");
  });

  it("reattach re-marks the recovered pane and opens a replay grace window", () => {
    const chatId = freshChatId();
    const binding = chatTerminalHostBinding(chatId);
    const firstPane = "pane-a";
    const secondPane = "pane-b";

    // A prior session in this chat had an agent running — durable flag set.
    armChatAutoName(chatId, firstPane);
    binding.onSession({ sessionId: "sid-1", backend: "dtach", degraded: false, attached: false }, firstPane);
    expect(chatHadAgentSession(chatId)).toBe(true);

    // App restart: a live session re-attaches under a DIFFERENT pane id.
    binding.onSession({ sessionId: "sid-1", backend: "dtach", degraded: false, attached: true }, secondPane);
    expect(isAgentPane(chatId, secondPane)).toBe(true);

    // The reattach replay is graced: output streamed right after re-attach
    // while the chat is unseen must not raise attention.
    setActiveChatForActivity(null);
    binding.onOutput("agent replay output that is long enough to matter", secondPane);
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS + 10);
    expect(chatAttention(chatId)).toBe(false);
  });
});

describe("chatTerminalHostBinding — archived output stays silent", () => {
  it("never drives busy/attention for an archived chat's still-running shell", () => {
    const chatId = freshChatId();
    const binding = chatTerminalHostBinding(chatId);
    const paneId = "pane-primary";
    armChatAutoName(chatId, paneId);
    archived.ids.add(chatId);
    setActiveChatForActivity(null);

    binding.onOutput("a lot of streamed agent output right here", paneId);
    vi.advanceTimersByTime(CHAT_BUSY_QUIET_MS + 10);
    binding.onBell(paneId);
    binding.onNotification("done", paneId);

    expect(chatBusy(chatId)).toBe(false);
    expect(chatAttention(chatId)).toBe(false);
  });
});

describe("chatTerminalHostBinding — deletion clears registry/session/title/activity state", () => {
  it("dispose clears the registry handle, activity, and agent/session ownership", () => {
    const chatId = freshChatId();
    const binding = chatTerminalHostBinding(chatId);
    const paneId = "pane-primary";

    binding.onReady({
      typeToFocused: vi.fn(),
      openInNewPane: vi.fn(),
      runInPrimary: vi.fn(),
      primarySpawnMode: () => "local",
      primaryRemotePty: () => null,
    });
    armChatAutoName(chatId, paneId);
    binding.onSession({ sessionId: "sid-1", backend: "dtach", degraded: false, attached: false }, paneId);
    setActiveChatForActivity(null);
    binding.onOutput("agent output before deletion", paneId);

    expect(getTerminalHost(chatId)).toBeDefined();
    expect(hasAgentPane(chatId)).toBe(true);
    expect(chatHadAgentSession(chatId)).toBe(true);

    disposeChatTerminalHostBinding(chatId);

    expect(getTerminalHost(chatId)).toBeUndefined();
    expect(hasAgentPane(chatId)).toBe(false);
    expect(isAgentPane(chatId, paneId)).toBe(false);
    expect(chatHadAgentSession(chatId)).toBe(false);
    expect(chatBusy(chatId)).toBe(false);
    expect(chatAttention(chatId)).toBe(false);

    // A binding requested again after dispose is a brand new one, not the
    // disposed instance still hanging around in the registry map.
    const rebound = chatTerminalHostBinding(chatId);
    expect(rebound).not.toBe(binding);
  });

  it("disposing a chat with no binding is a harmless no-op", () => {
    expect(() => disposeChatTerminalHostBinding(freshChatId())).not.toThrow();
  });
});

describe("chatTerminalHostBinding — pty needs-you resolves only on a real user submit (#331 review)", () => {
  it("bell raises attention; opening the chat leaves it needs-you; a real submit clears it", () => {
    const chatId = freshChatId();
    const binding = chatTerminalHostBinding(chatId);
    const paneId = "pane-primary";
    armChatAutoName(chatId, paneId);
    setActiveChatForActivity(null);

    binding.onBell(paneId);
    expect(chatAttention(chatId)).toBe(true);

    // Opening the chat is just looking — pty chats have no turn-start event
    // to hook the way structured agent chats do, so this must not silently
    // resolve the standing needs-you either (#331).
    setActiveChatForActivity(chatId);
    expect(chatAttention(chatId)).toBe(true);

    // A blank submit (stray Enter) is not the user acting — maybeAutoNameChat
    // already ignores it for auto-naming, and it must not resolve attention.
    binding.onUserSubmit("", paneId);
    expect(chatAttention(chatId)).toBe(true);

    // A real, non-blank submission IS the user acting — the pty analogue of
    // agentTurnStarted's "sent a message" — and resolves it.
    binding.onUserSubmit("y", paneId);
    expect(chatAttention(chatId)).toBe(false);
  });
});

describe("TerminalHost primary promotion — claim transfer before old-pane cleanup", () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.stubGlobal("matchMedia", () => ({ matches: true })); // reduced motion: close() is synchronous
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("transfers the surviving agent claim before either pane is reported closed", () => {
    const chatId = freshChatId();
    const binding = chatTerminalHostBinding(chatId);

    const events: string[] = [];
    const onPrimaryPaneRemount = vi.fn((from: string, to: string) => {
      events.push("remount");
      binding.onPrimaryPaneRemount(from, to);
    });
    const onPaneClosed = vi.fn((paneId: string) => {
      events.push(`closed:${paneId}`);
      binding.onPaneClosed(paneId);
    });

    let hostHandle: TerminalHostHandle | undefined;
    // The primary's very FIRST session report identifies it; the promoted
    // pane also reports a session once it mounts later, so only the first
    // call may set this.
    let primaryPaneId = "";
    let sessionReports = 0;

    dispose = render(
      () =>
        TerminalHost({
          chatId,
          cwd: "/proj",
          session: {
            projectRoot: "/proj",
            sessionId: null,
            backend: "dtach",
            onSession: (info, paneId) => {
              sessionReports++;
              if (sessionReports === 1) primaryPaneId = paneId;
              binding.onSession(info, paneId);
            },
          },
          onReady: (h) => (hostHandle = h),
          onPrimaryPaneRemount,
          onPaneClosed,
          onPaneExited: binding.onPaneExited,
        }),
      container,
    );

    expect(primaryPaneId).not.toBe("");
    // The chat's agent is running in the primary pane (a chip launch armed it).
    armChatAutoName(chatId, primaryPaneId);
    expect(isAgentPane(chatId, primaryPaneId)).toBe(true);

    // Split: a second pane joins the tree; the primary keeps its id.
    hostHandle!.openInNewPane("echo hi");

    // Close the primary via its real "Close pane" button — triggers TerminalHost's
    // internal promotion: a survivor is swapped in under a fresh pane id.
    const closeButtons = container.querySelectorAll<HTMLButtonElement>(".pf-pane-ctl--close");
    expect(closeButtons.length).toBe(2);
    closeButtons[0].click();

    expect(onPrimaryPaneRemount).toHaveBeenCalledTimes(1);
    const [fromPaneId, toPaneId] = onPrimaryPaneRemount.mock.calls[0];
    expect(fromPaneId).toBe(primaryPaneId);

    // The transfer event fired strictly before either pane's closed cleanup.
    const remountIdx = events.indexOf("remount");
    const closedIdxs = events
      .map((e, i) => (e.startsWith("closed:") ? i : -1))
      .filter((i) => i >= 0);
    expect(remountIdx).toBeGreaterThanOrEqual(0);
    expect(closedIdxs.length).toBeGreaterThan(0);
    for (const idx of closedIdxs) expect(remountIdx).toBeLessThan(idx);

    // The claim survives on the promoted pane; the old primary's is gone.
    expect(isAgentPane(chatId, toPaneId)).toBe(true);
    expect(isAgentPane(chatId, primaryPaneId)).toBe(false);
    expect(hasAgentPane(chatId)).toBe(true);
  });
});
