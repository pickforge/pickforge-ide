import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// chatAutoName imports findChat/setChatTitle from the workspace store (which
// pulls in the Tauri db + a SolidJS store). Stub the store with an in-memory
// chat map so the title logic can be exercised with no runtime. solid-js's
// createSignal is used for the typing-animation overrides; it works under node.
const flags = vi.hoisted(() => ({
  dynamicChatTitles: false,
  ompPiAgents: undefined as boolean | undefined,
}));

const store = vi.hoisted(() => {
  const chats = new Map<
    string,
    { chatId: string; title: string; titleSource: "default" | "auto" | "user" }
  >();
  return {
    chats,
    findChat: vi.fn((id: string) => chats.get(id)),
    setChatTitle: vi.fn(async (id: string, title: string) => {
      const c = chats.get(id);
      if (c) {
        c.title = title;
        if (flags.dynamicChatTitles) c.titleSource = "auto";
      }
      return true;
    }),
    resumeAutomaticChatTitles: vi.fn(async (id: string) => {
      const c = chats.get(id);
      if (c) c.titleSource = "auto";
    }),
  };
});
vi.mock("../../src/stores/workspace", () => ({
  findChat: store.findChat,
  setChatTitle: store.setChatTitle,
  resumeAutomaticChatTitles: store.resumeAutomaticChatTitles,
}));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) =>
    key === "dynamicChatTitles"
      ? flags.dynamicChatTitles
      : key === "ompPiAgents" && (flags.ompPiAgents ?? false),
  setFlagOverride: (key: string, enabled: boolean | undefined) => {
    if (key === "ompPiAgents") flags.ompPiAgents = enabled;
  },
}));
import { setFlagOverride } from "../../src/stores/flags";

import {
  armChatAutoName,
  chatTitleSourceForPolicy,
  cleanOscTitle,
  deriveAgentChatTitle,
  deriveMeaningfulUserTitle,
  forgetChatAutoName,
  handleAgentPaneExited,
  handleOscTitle,
  hasAgentPane,
  isAgentPane,
  markChatTitleManual,
  maybeAutoNameChat,
  resumeChatTitleAuto,
  selectDynamicAgentTitle,
  revokeAgentPane,
  transferAgentPaneOwnership,
  DEFAULT_CHAT_TITLE,
} from "../../src/lib/chatAutoName";

const isDefaultTitleForTest = (title: string) => title.trim() === DEFAULT_CHAT_TITLE;
const flagValues = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  store.chats.clear();
  flagValues.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => flagValues.get(key) ?? null,
    setItem: (key: string, value: string) => void flagValues.set(key, value),
    removeItem: (key: string) => void flagValues.delete(key),
    clear: () => flagValues.clear(),
    key: () => null,
    length: 0,
  } satisfies Storage);
  store.setChatTitle.mockClear();
  store.resumeAutomaticChatTitles.mockClear();
  flags.dynamicChatTitles = false;
  // Force the non-animated path (commit persists synchronously, no timers).
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  setFlagOverride("ompPiAgents", undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cleanOscTitle — noise filter", () => {
  it("drops empty / whitespace / control-only", () => {
    expect(cleanOscTitle("")).toBe("");
    expect(cleanOscTitle("   ")).toBe("");
    expect(cleanOscTitle("\u0001\u0007\u001b")).toBe("");
    // @ts-expect-error — defends the non-string guard.
    expect(cleanOscTitle(undefined)).toBe("");
  });

  it("drops user@host and bare hostnames / FQDNs", () => {
    expect(cleanOscTitle("dev@devbox")).toBe("");
    expect(cleanOscTitle("dev@devbox:~/code/app")).toBe("");
    expect(cleanOscTitle("devbox.local")).toBe("");
    expect(cleanOscTitle("host.example.com")).toBe("");
  });

  it("drops paths and cwds", () => {
    expect(cleanOscTitle("/home/dev/code/app")).toBe("");
    expect(cleanOscTitle("~/code/app")).toBe("");
    expect(cleanOscTitle("~")).toBe("");
    expect(cleanOscTitle("C:\\Users\\dev\\app")).toBe("");
    expect(cleanOscTitle("./scripts")).toBe("");
  });

  it("drops prompt-ending lines", () => {
    expect(cleanOscTitle("dev@box:~/app $")).toBe("");
    expect(cleanOscTitle("zsh %")).toBe("");
    expect(cleanOscTitle("root@box #")).toBe("");
    expect(cleanOscTitle("PS C:\\app>")).toBe("");
  });

  it("drops the bare shell / agent binary name", () => {
    expect(cleanOscTitle("zsh")).toBe("");
    expect(cleanOscTitle("bash")).toBe("");
    expect(cleanOscTitle("claude")).toBe("");
    expect(cleanOscTitle("codex")).toBe("");
  });

  it("keeps a real agent summary, tidied", () => {
    expect(cleanOscTitle("Fixing the login redirect bug")).toBe(
      "Fixing the login redirect bug",
    );
    // Leading lowercase is capitalised; surrounding quotes stripped.
    expect(cleanOscTitle('"add a dark mode toggle"')).toBe("Add a dark mode toggle");
    // A summary that merely contains a slash but has spaces is kept.
    expect(cleanOscTitle("Refactor src/auth flow")).toBe("Refactor src/auth flow");
  });
});

describe("deriveAgentChatTitle", () => {
  it("truncates long titles on a word boundary", () => {
    expect(
      deriveAgentChatTitle(
        "please refactor the authentication flow so settings handles expired sessions gracefully",
      ),
    ).toBe("Please refactor the authentication flow so…");
  });

  it("strips markdown, quotes, and urls", () => {
    expect(
      deriveAgentChatTitle(
        '> ## "fix [login](https://example.test) **redirect** `bug`" https://example.test/details',
      ),
    ).toBe("Fix login redirect bug");
  });

  it("falls back to the first assistant text for generic short user text", () => {
    expect(
      deriveAgentChatTitle(
        "hi",
        "I can help wire the image paste path into the agent chat store.",
      ),
    ).toBe("I can help wire the image paste path into…");
  });
});

describe("handleOscTitle — debounce + ownership", () => {
  // The module keeps per-chat ownership state for the session that never clears
  // between tests; give each test a FRESH chat id so its state can't leak.
  let counter = 0;
  // Seed a chat AND mark pane-0 as its agent-owned pane (an OSC title is only
  // adopted from the agent pane now), so the title pipeline is exercised. Pass
  // `agentPane: null` to seed a chat with NO agent pane (for the gating test).
  const seed = (title = DEFAULT_CHAT_TITLE, agentPane: string | null = "pane-0"): string => {
    const id = `chat-${++counter}`;
    store.chats.set(id, {
      chatId: id,
      title,
      titleSource: isDefaultTitleForTest(title) ? "default" : "user",
    });
    if (agentPane) armChatAutoName(id, agentPane);
    return id;
  };

  it("commits the title only after the debounce quiet window", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Working on auth");
    expect(store.setChatTitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1199);
    expect(store.setChatTitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Working on auth");
  });

  it("keeps legacy provenance untouched while the feature flag is off", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Legacy automatic title");
    vi.advanceTimersByTime(1200);

    expect(store.chats.get(id)).toMatchObject({
      title: "Legacy automatic title",
      titleSource: "default",
    });
  });

  it("debounces rapid rewrites, committing only the last", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Reading files");
    vi.advanceTimersByTime(800);
    handleOscTitle(id, "pane-0", "Editing the router");
    vi.advanceTimersByTime(800); // 1600 since first, 800 since second
    expect(store.setChatTitle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400); // 1200 since the last update
    expect(store.setChatTitle).toHaveBeenCalledTimes(1);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Editing the router");
  });

  it("ignores noise titles without arming a commit", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "dev@box:~/app $");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("lets the FIRST pane own the title; a second split can't steal it", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "Pane zero summary");
    handleOscTitle(id, "pane-1", "Pane one summary"); // ignored — not the owner
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenCalledTimes(1);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Pane zero summary");
  });

  it("ignores OSC titles from a chat with NO agent pane", () => {
    const id = seed(DEFAULT_CHAT_TITLE, null); // no agent ever launched
    handleOscTitle(id, "pane-0", "A build script set this title");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("only adopts OSC titles from the agent-owned pane, not other split panes", () => {
    const id = seed(DEFAULT_CHAT_TITLE, "pane-1"); // agent runs in pane-1
    // A non-agent split pane (pane-0) sets a window title — must be ignored.
    handleOscTitle(id, "pane-0", "Editor opened a file");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
    // The agent's own pane names the chat.
    handleOscTitle(id, "pane-1", "Wiring up the agent task");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Wiring up the agent task");
  });

  it("never overwrites a manually renamed chat", () => {
    const id = seed();
    markChatTitleManual(id);
    store.chats.get(id)!.title = "My deliberate name";
    handleOscTitle(id, "pane-0", "Some agent summary");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("a manual rename mid-debounce cancels the pending commit", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "About to be cancelled");
    vi.advanceTimersByTime(600);
    markChatTitleManual(id);
    store.chats.get(id)!.title = "User typed this";
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("refines an OSC name from the SAME owning pane after first commit", () => {
    const id = seed();
    handleOscTitle(id, "pane-0", "First summary");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenLastCalledWith(id, "First summary");
    expect(store.chats.get(id)!.title).toBe("First summary");
    // Title is no longer the default, but the same pane still owns it.
    handleOscTitle(id, "pane-0", "Refined summary");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenLastCalledWith(id, "Refined summary");
  });
});

// isAgentPane is the gate the rail's "live session" ember glow now relies on:
// only a pane KNOWN to run an agent drives the running/working cue, so a plain
// interactive shell (a prompt, `ls`, a build) never glows. These cover the ways
// a pane becomes agent-owned (chip/hotkey arm, hand-typed launch) and confirm a
// bare shell pane is not.
describe("isAgentPane — agent ownership for the live-session glow", () => {
  let counter = 1000;
  const mkChat = (title = DEFAULT_CHAT_TITLE): string => {
    const id = `agent-chat-${++counter}`;
    store.chats.set(id, {
      chatId: id,
      title,
      titleSource: isDefaultTitleForTest(title) ? "default" : "user",
    });
    return id;
  };

  it("is false for a chat with no launched/typed agent (plain shell pane)", () => {
    const id = mkChat();
    expect(isAgentPane(id, "pane-0")).toBe(false);
  });

  it("is true for every pane a chip/hotkey armed", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    armChatAutoName(id, "pane-1");
    expect(isAgentPane(id, "pane-0")).toBe(true);
    expect(isAgentPane(id, "pane-1")).toBe(true);
    expect(isAgentPane(id, "pane-2")).toBe(false);
  });

  it("marks the pane when a recognised agent command is hand-typed", () => {
    const id = mkChat();
    // A plain shell command does NOT mark the pane as an agent.
    maybeAutoNameChat(id, "ls -la", "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(false);
    // Typing `claude …` does.
    maybeAutoNameChat(id, "claude fix the bug", "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(true);
  });

  it("preserves Pi detection and hides OMP detection while the flag is off", () => {
    const piChat = mkChat();
    maybeAutoNameChat(piChat, "pi fix the terminal title", "pane-pi");
    expect(isAgentPane(piChat, "pane-pi")).toBe(true);

    const ompChat = mkChat();
    maybeAutoNameChat(ompChat, "omp fix the terminal title", "pane-omp");
    expect(isAgentPane(ompChat, "pane-omp")).toBe(false);
    expect(store.chats.get(ompChat)?.title).toBe(DEFAULT_CHAT_TITLE);
    expect(cleanOscTitle("omp")).toBe("Omp");
  });

  it("recognises OMP activity and strips its value flags only when enabled", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();
    maybeAutoNameChat(
      id,
      "omp --provider anthropic --model claude-sonnet-4-6 fix the terminal title",
      "pane-omp",
    );

    expect(isAgentPane(id, "pane-omp")).toBe(true);
    expect(store.chats.get(id)?.title).toBe("Fix the terminal title");
    expect(cleanOscTitle("omp")).toBe("");
  });

  it("keeps OMP continuation boolean when deriving the prompt title", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();

    maybeAutoNameChat(id, "omp -c fix parser", "pane-omp");

    expect(store.chats.get(id)?.title).toBe("Fix parser");
  });

  it("never persists quoted OMP credentials, prompts, profiles, or config paths", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();
    maybeAutoNameChat(
      id,
      "omp --api-key 'omp_sk_live_SUPER SECRET' --system-prompt \"SYSTEM SECRET WORDS\" "
        + "--config '/tmp/private config.yml' --profile 'work profile' fix quoted titles",
      "pane-omp",
    );

    expect(store.chats.get(id)?.title).toBe("Fix quoted titles");
    expect(store.chats.get(id)?.title).not.toMatch(/SECRET|private|work profile/i);
  });

  it("never persists values from unknown OMP extension flags", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();
    maybeAutoNameChat(
      id,
      "omp --extension-toggle --jira-token 'jira_SECRET' fix extension auth",
      "pane-omp",
    );

    expect(store.chats.get(id)?.title).toBe("Fix extension auth");
    expect(store.chats.get(id)?.title).not.toMatch(/SECRET/i);
  });

  it("never persists Pi credentials, prompts, sessions, templates, or MCP paths", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();
    maybeAutoNameChat(
      id,
      "pi --api-key=pi_sk_live_SUPER_SECRET --append-system-prompt 'PRIVATE PI INSTRUCTIONS' "
        + "--session '/tmp/private session.jsonl' --prompt-template '/tmp/private template.md' "
        + "--mcp-config '/tmp/unsupported secret mcp.json' --jira-token 'JIRA SECRET' "
        + "review title privacy",
      "pane-pi",
    );

    expect(store.chats.get(id)?.title).toBe("Review title privacy");
    expect(store.chats.get(id)?.title).not.toMatch(/SECRET|private|INSTRUCTIONS/i);
  });

  it.each(["omp", "pi"])("skips %s file attachments before deriving a title", (binary) => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();

    maybeAutoNameChat(id, `${binary} @/Users/me/PRIVATE.md fix attachments`, `pane-${binary}`);

    expect(store.chats.get(id)?.title).toBe("Fix attachments");
    expect(store.chats.get(id)?.title).not.toMatch(/PRIVATE/i);
  });

  it.each([
    ["omp", "config set api-key CONFIG_SECRET"],
    ["omp", "--export session.jsonl /tmp/PRIVATE.html"],
    ["pi", "install PRIVATE_PACKAGE"],
    ["pi", "--export session.jsonl /tmp/PRIVATE.html"],
  ])("does not treat %s utility invocation as an agent prompt", (binary, args) => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();
    const paneId = `pane-${binary}`;

    maybeAutoNameChat(id, `${binary} ${args}`, paneId);

    expect(isAgentPane(id, paneId)).toBe(false);
    expect(store.chats.get(id)?.title).toBe(DEFAULT_CHAT_TITLE);
  });

  it("never persists Pi secrets while the OMP/Pi rollout flag is off", () => {
    const id = mkChat();
    maybeAutoNameChat(
      id,
      "pi --api-key 'pi_sk_live_SUPER SECRET' --system-prompt 'PRIVATE INSTRUCTIONS' "
        + "--session '/tmp/private session.jsonl' --config '/tmp/private config.json' safe title",
      "pane-pi",
    );

    expect(store.chats.get(id)?.title).toBe("Safe title");
    expect(store.chats.get(id)?.title).not.toMatch(/SECRET|PRIVATE|INSTRUCTIONS/i);
  });

  it.each([
    ["omp fix parser; echo SHELL_TAIL", "Fix parser"],
    ["omp fix parser && echo SHELL_TAIL", "Fix parser"],
    ["omp fix parser || echo SHELL_TAIL", "Fix parser"],
    ["omp fix parser | tee SHELL_TAIL", "Fix parser"],
    ["omp fix parser > /tmp/PRIVATE_REDIRECT", "Fix parser"],
    ["omp fix parser 2>/tmp/PRIVATE_REDIRECT", "Fix parser"],
    ["omp fix parser\nprintf SHELL_TAIL", "Fix parser"],
    ["omp fix parser # PRIVATE_COMMENT", "Fix parser"],
  ])("stops OMP title extraction before shell syntax in %s", (command, expected) => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();

    maybeAutoNameChat(id, command, "pane-omp");

    expect(store.chats.get(id)?.title).toBe(expected);
    expect(store.chats.get(id)?.title).not.toMatch(/SHELL_TAIL|PRIVATE/i);
  });

  it("preserves shell syntax that is quoted as prompt text", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();

    maybeAutoNameChat(id, "omp 'fix ; # > | parser' && echo SHELL_TAIL", "pane-omp");

    expect(store.chats.get(id)?.title).toBe("Fix ; # > | parser");
  });

  it("consumes every current OMP string flag in separated and equals forms", () => {
    setFlagOverride("ompPiAgents", true);
    const id = mkChat();
    const flags = [
      "--cwd",
      "-C",
      "--config",
      "--mode",
      "--fork",
      "--provider",
      "--model",
      "-m",
      "--smol",
      "--slow",
      "--plan",
      "--max-time",
      "--api-key",
      "--system-prompt",
      "--append-system-prompt",
      "--provider-session-id",
      "--prompt-cache-key",
      "--session-dir",
      "--models",
      "--tools",
      "--thinking",
      "--hook",
      "--extension",
      "-e",
      "--plugin-dir",
      "--skills",
      "--approval-mode",
      "--profile",
      "--mcp-config",
    ];
    const args = flags
      .map((flag, index) =>
        flag.startsWith("--") && index % 2 === 0
          ? `${flag}=SECRET_${index}`
          : `${flag} 'SECRET ${index}'`,
      )
      .join(" ");

    maybeAutoNameChat(id, `omp ${args} keep safe title`, "pane-omp");

    expect(store.chats.get(id)?.title).toBe("Keep safe title");
    expect(store.chats.get(id)?.title).not.toMatch(/SECRET/i);
  });

  it("consumes OMP optional session values without swallowing a following flag", () => {
    setFlagOverride("ompPiAgents", true);
    const valued = mkChat();
    const bare = mkChat();

    maybeAutoNameChat(
      valued,
      "omp --resume=RESUME_SECRET -r 'SESSION SECRET' --session 'CACHE SECRET' safe session title",
      "pane-valued",
    );
    maybeAutoNameChat(bare, "omp --session --print safe bare session title", "pane-bare");

    expect(store.chats.get(valued)?.title).toBe("Safe session title");
    expect(store.chats.get(valued)?.title).not.toMatch(/SECRET/i);
    expect(store.chats.get(bare)?.title).toBe("Safe bare session title");
  });

  it("marks hand-typed agent commands in non-default titled chats", () => {
    const id = mkChat("Existing title");
    maybeAutoNameChat(id, "codex --model gpt-5.5 fix the bug", "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(true);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("transfers agent activity ownership to a remounted pane id", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    transferAgentPaneOwnership(id, "pane-0", "pane-remount");
    expect(isAgentPane(id, "pane-0")).toBe(false);
    expect(isAgentPane(id, "pane-remount")).toBe(true);
  });

  it("keeps agent activity ownership after a manual rename", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(true);
    markChatTitleManual(id);
    expect(isAgentPane(id, "pane-0")).toBe(true);
  });

  it("marks a hand-typed launch in another pane of a chip-armed default chat", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0"); // chip launch — pane-0 armed for the title
    maybeAutoNameChat(id, "codex fix the tests", "pane-1");
    expect(isAgentPane(id, "pane-1")).toBe(true);
    // The arming stands: the first real prompt in pane-0 still names the chat.
    maybeAutoNameChat(id, "refactor the auth flow", "pane-0");
    expect(store.chats.get(id)!.title).toBe("Refactor the auth flow");
  });

  it("revoking a closed pane removes its activity and title claims", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    expect(hasAgentPane(id)).toBe(true);
    revokeAgentPane(id, "pane-0");
    expect(isAgentPane(id, "pane-0")).toBe(false);
    expect(hasAgentPane(id)).toBe(false);
    handleOscTitle(id, "pane-0", "Ghost pane summary");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
  });

  it("forgetChatAutoName drops all state and cancels a pending OSC commit", () => {
    const id = mkChat();
    armChatAutoName(id, "pane-0");
    handleOscTitle(id, "pane-0", "About to be deleted");
    forgetChatAutoName(id);
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();
    expect(isAgentPane(id, "pane-0")).toBe(false);
  });
});

describe("title authority — the newest agent launch names the chat", () => {
  let counter = 3000;
  const mkChat = (title = DEFAULT_CHAT_TITLE): string => {
    const id = `authority-chat-${++counter}`;
    store.chats.set(id, {
      chatId: id,
      title,
      titleSource: isDefaultTitleForTest(title) ? "default" : "user",
    });
    return id;
  };

  it("a newer launch takes naming over; the stale agent pane is ignored", () => {
    const id = mkChat();
    // Hand-typed claude in a split names the chat and holds title authority.
    maybeAutoNameChat(id, "claude fix the login bug", "pane-1");
    expect(store.chats.get(id)!.title).toBe("Fix the login bug");

    // A chip-launched codex in the primary takes the authority with it.
    armChatAutoName(id, "pane-0");
    handleOscTitle(id, "pane-1", "Stale claude summary");
    vi.advanceTimersByTime(1200);
    expect(store.chats.get(id)!.title).toBe("Fix the login bug");

    handleOscTitle(id, "pane-0", "Codex task summary");
    vi.advanceTimersByTime(1200);
    expect(store.chats.get(id)!.title).toBe("Codex task summary");
  });
});

describe("dynamic title policy", () => {
  it("uses only meaningful user-owned task text", () => {
    expect(deriveMeaningfulUserTitle("hi")).toBe("");
    expect(deriveMeaningfulUserTitle("thanks")).toBe("");
    expect(deriveMeaningfulUserTitle("fix the OAuth callback race")).toBe(
      "Fix the OAuth callback race",
    );
  });

  it("refreshes locally on meaningful turns 1, 4, 7 and ignores filler", () => {
    const base = {
      currentTitle: DEFAULT_CHAT_TITLE,
      titleSource: "default" as const,
    };
    expect(
      selectDynamicAgentTitle({
        ...base,
        completedUserTexts: ["hi", "fix the login redirect"],
      }),

    ).toBe("Fix the login redirect");
    expect(
      selectDynamicAgentTitle({
        currentTitle: "Fix the login redirect",
        titleSource: "auto",
        completedUserTexts: [
          "fix the login redirect",
          "add coverage",
          "check the migration",
        ],
      }),
    ).toBe("");
    expect(
      selectDynamicAgentTitle({
        currentTitle: "Fix the login redirect",
        titleSource: "auto",
        completedUserTexts: [
          "fix the login redirect",
          "add coverage",
          "check the migration",
          "update the settings navigation",
        ],
      }),
    ).toBe("Update the settings navigation");
  });

  it("adopts untouched default chats created while the flag was off", () => {
    expect(
      chatTitleSourceForPolicy({
        title: DEFAULT_CHAT_TITLE,
        titleSource: "user",
        titleUpdatedAt: 0,
      }),
    ).toBe("default");
    expect(
      chatTitleSourceForPolicy({
        title: DEFAULT_CHAT_TITLE,
        titleSource: "user",
        titleUpdatedAt: 10,
      }),
    ).toBe("user");
    expect(
      chatTitleSourceForPolicy({
        title: " New chat ",
        titleSource: "user",
        titleUpdatedAt: 0,
      }),
    ).toBe("user");
    expect(
      chatTitleSourceForPolicy({
        title: "Legacy non-default title",
        titleSource: "default",
        titleUpdatedAt: 0,
      }),
    ).toBe("user");
  });

  it("gives provider plan/title signals precedence without waiting for cadence", () => {
    expect(
      selectDynamicAgentTitle({
        currentTitle: "Fix the login redirect",
        titleSource: "auto",
        completedUserTexts: ["fix login", "add coverage"],
        providerTitle: "Rework OAuth session recovery",
      }),
    ).toBe("Rework OAuth session recovery");
  });

  it("does not rewrite normalized-equal candidates or persisted manual titles", () => {
    expect(
      selectDynamicAgentTitle({
        currentTitle: "Fix OAuth callback",
        titleSource: "auto",
        completedUserTexts: ["fix oauth callback"],
        providerTitle: "  FIX   OAUTH CALLBACK ",
      }),
    ).toBe("");
    expect(
      selectDynamicAgentTitle({
        currentTitle: "My deliberate title",
        titleSource: "user",
        completedUserTexts: ["replace the entire task"],
        providerTitle: "Provider wants another title",
      }),
    ).toBe("");
  });

  it("applies terminal milestones and lets debounced OSC override local fallback", () => {
    flags.dynamicChatTitles = true;
    const id = "dynamic-terminal";
    store.chats.set(id, {
      chatId: id,
      title: DEFAULT_CHAT_TITLE,
      titleSource: "default",
    });
    armChatAutoName(id, "pane-0");

    maybeAutoNameChat(id, "hi", "pane-0");
    expect(store.setChatTitle).not.toHaveBeenCalled();
    maybeAutoNameChat(id, "fix the login redirect", "pane-0");
    expect(store.setChatTitle).toHaveBeenLastCalledWith(id, "Fix the login redirect");
    maybeAutoNameChat(id, "add unit coverage", "pane-0");
    maybeAutoNameChat(id, "check the migration", "pane-0");
    expect(store.setChatTitle).toHaveBeenCalledTimes(1);
    maybeAutoNameChat(id, "update the settings navigation", "pane-0");
    expect(store.setChatTitle).toHaveBeenLastCalledWith(
      id,
      "Update the settings navigation",
    );

    handleOscTitle(id, "pane-0", "Provider plan: verify restart persistence");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenLastCalledWith(
      id,
      "Provider plan: verify restart persistence",
    );
  });

  it("revokes title authority on the PTY lifecycle exit without relying on OSC", () => {
    flags.dynamicChatTitles = true;
    const id = "dynamic-post-agent-shell";
    store.chats.set(id, {
      chatId: id,
      title: DEFAULT_CHAT_TITLE,
      titleSource: "default",
    });

    maybeAutoNameChat(id, "claude fix the login redirect", "pane-0");
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Fix the login redirect");
    store.setChatTitle.mockClear();

    // Even a provider title already waiting in the debounce queue loses
    // authority when the PTY/session process reports its lifecycle exit.
    handleOscTitle(id, "pane-0", "Provider title that must be cancelled");
    handleAgentPaneExited(id, "pane-0");
    vi.advanceTimersByTime(2000);
    for (const line of [
      "run the project tests",
      "check the database migration",
      "update the settings navigation",
      "verify the release build",
    ]) {
      maybeAutoNameChat(id, line, "pane-0");
    }
    expect(store.setChatTitle).not.toHaveBeenCalled();
    expect(isAgentPane(id, "pane-0")).toBe(false);
  });

  it("honors a persisted manual lock after restart and can resume automatic titles", async () => {
    flags.dynamicChatTitles = true;
    const id = "dynamic-restart";
    store.chats.set(id, {
      chatId: id,
      title: "My deliberate title",
      titleSource: "user",
    });
    armChatAutoName(id, "pane-0");

    handleOscTitle(id, "pane-0", "Provider tries to replace it");
    vi.advanceTimersByTime(2000);
    expect(store.setChatTitle).not.toHaveBeenCalled();

    await resumeChatTitleAuto(id);
    expect(store.resumeAutomaticChatTitles).toHaveBeenCalledWith(id);
    handleOscTitle(id, "pane-0", "Provider may update it now");
    vi.advanceTimersByTime(1200);
    expect(store.setChatTitle).toHaveBeenCalledWith(id, "Provider may update it now");
  });
});
