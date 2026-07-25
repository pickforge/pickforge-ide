// VRT-only Tauri mock. When VITE_PICKFORGE_VRT=1, install a fake
// window.__TAURI_INTERNALS__ so the app renders with sample data in a plain
// browser (Playwright), with no Tauri runtime.
import type { AgentEvent, AgentTimelineEntry } from "./agentChat";
import type { ChangedFile, ChangeSet, WorkingTreeChanges } from "./changes";
import type { Chat } from "./db";

const now = 1_750_000_000_000;
const VRT_AGENT_CHAT_FIXTURE_KEY = "pickforge.vrt.agentChatFixture";
// Swaps the fixture's usage row to a used > window reading, without touching
// the default fixture's numbers (and its pinned golden) — see #307's
// ContextMeter overflow warning state.
const VRT_AGENT_CHAT_CONTEXT_OVERFLOW_KEY = "pickforge.vrt.agentChatContextOverflow";
const VRT_REMOTE_DEVICE_FIXTURE_KEY = "pickforge.vrt.remoteDeviceFixture";
const VRT_REMOTE_HOST = "acorns-macbook.tailnet.ts.net";
// #306 PR1's flat chat list (flag `flatChatList`) VRT scenario: adds a
// needs-you and a working chat (their busy/attention state is seeded by
// installFlatChatListFixture, src/lib/flatChatListFixture.ts) plus an older
// quiet chat, spread across both sample projects.
const VRT_FLAT_CHAT_LIST_FIXTURE_KEY = "pickforge.vrt.flatChatListFixture";
// Set to a projectRoot to make chats_list reject for just that project — the
// flat list's eager cross-project load must survive one project failing
// (#306 PR1 review finding P2-2).
const VRT_FLAT_CHAT_LIST_LOAD_ERROR_KEY = "pickforge.vrt.flatChatListLoadErrorRoot";

// A trimmed, representative slice of `omp models --json --no-extensions`
// output (captured from a real omp 17.1.1 install, truncated to a handful of
// models across providers).
const OMP_MODELS_FIXTURE = JSON.stringify({
  models: [
    {
      provider: "ollama-cloud",
      id: "cogito-2.1:671b",
      selector: "ollama-cloud/cogito-2.1:671b",
      name: "cogito-2.1:671b",
      contextWindow: 163840,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
      provider: "openai-codex",
      id: "gpt-5.4",
      selector: "openai-codex/gpt-5.4",
      name: "GPT-5.4",
      contextWindow: 1000000,
      cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
    },
    {
      provider: "xai-oauth",
      id: "grok-4.20-0309-reasoning",
      selector: "xai-oauth/grok-4.20-0309-reasoning",
      name: "Grok 4.20 (Reasoning)",
      contextWindow: 2000000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
});

// A trimmed, representative slice of `codex debug models --bundled` output
// (captured from a real codex-cli 0.144.6 install). `gpt-5.6-sol` is also in
// the curated static table, so this exercises "curated metadata wins on
// merge"; `codex-auto-review` is "hide" visibility, exercising the picker's
// filter. Neither changes the default selected model in VRT.
const CODEX_MODELS_FIXTURE = JSON.stringify({
  models: [
    {
      slug: "gpt-5.6-sol",
      display_name: "GPT-5.6-Sol",
      default_reasoning_level: "low",
      supported_reasoning_levels: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high" },
        { effort: "xhigh" },
        { effort: "max" },
        { effort: "ultra" },
      ],
      visibility: "list",
      supported_in_api: true,
    },
    {
      slug: "codex-auto-review",
      display_name: "Codex Auto Review",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [{ effort: "medium" }],
      visibility: "hide",
      supported_in_api: true,
    },
  ],
});
const VRT_REMOTE_ROOT = "/Users/elberte/Projects/Personal/sample_flutter_app";

const AGENT_CHAT_FIXTURE: Chat = { chatId: "chat-agent-vrt", projectRoot: "/home/dev/acme-app", title: "Structured chat fixture", titleSource: "user", titleUpdatedAt: now, kind: "agent", agentId: "codex", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 };

// #231 PR2/PR3 fixtures: one completed turn's ChangeSet (the same two files
// the AGENT_CHAT_HISTORY fixture's `fileChange` item reports — its `diff` is
// null, so per the "unknown stats stay unknown, never 0" rule these carry no
// known line counts, exercising the chat receipt's unknown-stat rendering),
// the live working-tree ChangeSet, and a shared unified-diff body for the
// lazy per-file fetch.
const CHANGES_TURN_FIXTURE = (projectRoot: string): ChangeSet => ({
  id: `turn:${AGENT_CHAT_FIXTURE.chatId}:1`,
  scope: "turn",
  source: "providerSnapshot",
  chatId: AGENT_CHAT_FIXTURE.chatId,
  turnSeq: 1,
  repoRoot: projectRoot,
  capturedAt: now,
  stale: false,
  truncated: false,
  files: [
    {
      path: "src/lib/tauriMock.ts",
      oldPath: null,
      status: "modify",
      // Provider/turn source: staged/unstaged doesn't apply.
      staged: null,
      unstaged: null,
      additions: null,
      deletions: null,
      binary: false,
      truncated: false,
      diffAvailable: false,
      kind: "regular",
    },
    {
      path: "tests/vrt/agent-chat.spec.ts",
      oldPath: null,
      status: "add",
      staged: null,
      unstaged: null,
      additions: null,
      deletions: null,
      binary: false,
      truncated: false,
      diffAvailable: false,
      kind: "regular",
    },
  ],
  totals: { files: 2, additions: 0, deletions: 0 },
});

// #231 PR4's Workbench Changes review surface VRT scenario opts into one
// extra rename row on top of the fixture every other VRT spec already relies
// on (`lib/new_widget.dart`'s unknown stats and the staged/unstaged split
// already exercise the rest of the "mixed change-set" surface). Gated behind
// its own key rather than always appending the row, so specs that don't set
// it (the already-pinned `workbench`/`agent-chat` goldens) keep rendering
// exactly the fixture they were pinned against.
const VRT_CHANGES_REVIEW_SURFACE_FIXTURE_KEY = "pickforge.vrt.changesReviewSurfaceFixture";
function changesReviewSurfaceFixtureEnabled(): boolean {
  try {
    return localStorage.getItem(VRT_CHANGES_REVIEW_SURFACE_FIXTURE_KEY) === "1";
  } catch {
    return false;
  }
}

// #231 PR5's hard-state VRT scenario: submodule/symlink/mode-only/conflict/
// binary-with-size/truncated-with-load-more, on top of the mixed fixture
// every other Changes VRT spec already relies on. Gated behind its own key
// for the same reason `changesReviewSurfaceFixtureEnabled` is — specs that
// don't set it keep rendering exactly the fixture they were pinned against.
const VRT_CHANGES_HARD_STATES_FIXTURE_KEY = "pickforge.vrt.changesHardStatesFixture";
function changesHardStatesFixtureEnabled(): boolean {
  try {
    return localStorage.getItem(VRT_CHANGES_HARD_STATES_FIXTURE_KEY) === "1";
  } catch {
    return false;
  }
}
const HARD_STATE_SUBMODULE_PATH = "vendor/lib";
const HARD_STATE_SYMLINK_PATH = "config/link.txt";
const HARD_STATE_MODE_ONLY_PATH = "scripts/run.sh";
const HARD_STATE_CONFLICT_PATH = "src/conflict.rs";
const HARD_STATE_BINARY_PATH = "assets/logo.png";
const HARD_STATE_BINARY_SIZE = 2048;
const HARD_STATE_TRUNCATED_PATH = "src/huge_generated.rs";

/** The extra rows the hard-states VRT fixture appends (#231 PR5) — split out
 *  of `CHANGES_WORKING_TREE_FIXTURE` purely to keep that function short. */
function hardStateFixtureFiles(): ChangedFile[] {
  return [
    {
      path: HARD_STATE_SUBMODULE_PATH,
      oldPath: null,
      status: "modify",
      staged: false,
      unstaged: true,
      additions: null,
      deletions: null,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "submodule",
    },
    {
      path: HARD_STATE_SYMLINK_PATH,
      oldPath: null,
      status: "modify",
      staged: false,
      unstaged: true,
      additions: null,
      deletions: null,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "symlink",
    },
    {
      path: HARD_STATE_MODE_ONLY_PATH,
      oldPath: null,
      status: "modify",
      staged: false,
      unstaged: true,
      additions: 0,
      deletions: 0,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "modeOnly",
    },
    {
      path: HARD_STATE_CONFLICT_PATH,
      oldPath: null,
      status: "conflict",
      staged: false,
      unstaged: false,
      additions: null,
      deletions: null,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    },
    {
      path: HARD_STATE_BINARY_PATH,
      oldPath: null,
      status: "modify",
      staged: false,
      unstaged: true,
      additions: null,
      deletions: null,
      binary: true,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    },
    {
      path: HARD_STATE_TRUNCATED_PATH,
      oldPath: null,
      status: "modify",
      staged: false,
      unstaged: true,
      additions: 50_000,
      deletions: 10,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    },
  ];
}

const CHANGES_WORKING_TREE_FIXTURE = (projectRoot: string): WorkingTreeChanges => {
  const files: ChangedFile[] = [
    {
      path: "lib/login.dart",
      oldPath: null,
      status: "modify",
      // Git-live source: staged/unstaged is always known, never null.
      staged: false,
      unstaged: true,
      additions: 4,
      deletions: 1,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    },
    {
      path: "lib/new_widget.dart",
      oldPath: null,
      status: "add",
      staged: false,
      unstaged: true,
      additions: null,
      deletions: null,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    },
    {
      path: "README.md",
      oldPath: null,
      status: "add",
      staged: true,
      unstaged: false,
      additions: 12,
      deletions: 0,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    },
  ];
  if (changesReviewSurfaceFixtureEnabled()) {
    files.push({
      path: "lib/widgets/new_button.dart",
      oldPath: "lib/widgets/old_button.dart",
      status: "rename",
      staged: false,
      unstaged: true,
      additions: 2,
      deletions: 1,
      binary: false,
      truncated: false,
      diffAvailable: true,
      kind: "regular",
    });
  }
  if (changesHardStatesFixtureEnabled()) {
    files.push(...hardStateFixtureFiles());
  }
  const additions = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const deletions = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return {
    state: "ready",
    changeSet: {
      id: `workingTree:${projectRoot}`,
      scope: "workingTree",
      source: "gitLive",
      chatId: null,
      turnSeq: null,
      repoRoot: projectRoot,
      capturedAt: now,
      stale: false,
      truncated: false,
      files,
      totals: { files: files.length, additions, deletions },
    },
  };
};

const CHANGES_DIFF_FIXTURE = {
  diff: "diff --git a/lib/login.dart b/lib/login.dart\n@@ -1,3 +1,3 @@\n-old line\n+new line\n context\n",
  binary: false,
  truncated: false,
  available: true,
  sizeBytes: null,
  invalidUtf8: false,
};

/** Path-aware diff fetch for the hard-states VRT fixture: everything else
 *  keeps returning the shared `CHANGES_DIFF_FIXTURE` (unchanged for every
 *  other spec). The truncated file's `skipLines` argument is recorded so the
 *  VRT spec can assert the "load more" click asked for the next chunk, not
 *  merely that SOME request fired again. */
function changesHardStateFileDiff(args: Record<string, unknown>) {
  if (!changesHardStatesFixtureEnabled()) return CHANGES_DIFF_FIXTURE;
  if (args.path === HARD_STATE_BINARY_PATH) {
    return { diff: null, binary: true, truncated: false, available: true, sizeBytes: HARD_STATE_BINARY_SIZE, invalidUtf8: false };
  }
  if (args.path === HARD_STATE_TRUNCATED_PATH) {
    const globals = window as unknown as Record<string, unknown>;
    const skipLines = args.skipLines as number;
    globals.__PICKFORGE_VRT_LAST_DIFF_SKIP_LINES__ = skipLines;
    // First chunk (skipLines=0) is 2 lines ("@@ ...@@" + "-old") and reports
    // truncated; the load-more chunk (skipLines=2, exactly past those two
    // lines) is the hunk's remaining "+new" line and reports NOT truncated —
    // the concatenation of the two is one well-formed hunk.
    return skipLines === 0
      ? { diff: "@@ -1,2 +1,2 @@\n-old\n", binary: false, truncated: true, available: true, sizeBytes: null, invalidUtf8: false }
      : { diff: "+new\n", binary: false, truncated: false, available: true, sizeBytes: null, invalidUtf8: false };
  }
  return CHANGES_DIFF_FIXTURE;
}

const SAMPLE_PROJECTS = [
  { projectRoot: "/home/dev/acme-app", displayName: "acme-app", createdAt: now, lastOpenedAt: now, sortOrder: 0, archivedAt: null, remoteHost: null, remoteRoot: null },
  { projectRoot: "/home/dev/widgets", displayName: "widgets", createdAt: now, lastOpenedAt: now, sortOrder: 1, archivedAt: null, remoteHost: null, remoteRoot: null },
];

function remoteDeviceFixture(): string | null {
  try {
    return localStorage.getItem(VRT_REMOTE_DEVICE_FIXTURE_KEY);
  } catch {
    return null;
  }
}

function projectsForFixture() {
  if (!remoteDeviceFixture()) return SAMPLE_PROJECTS;
  return SAMPLE_PROJECTS.map((project, index) => index === 0
    ? { ...project, remoteHost: VRT_REMOTE_HOST, remoteRoot: VRT_REMOTE_ROOT }
    : project);
}
const SAMPLE_CHATS: Chat[] = [
  { chatId: "chat-1", projectRoot: "/home/dev/acme-app", title: "Login screen", titleSource: "user", titleUpdatedAt: now, kind: "terminal", agentId: "claudeCode", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 },
  { chatId: "chat-2", projectRoot: "/home/dev/acme-app", title: "Settings polish", titleSource: "user", titleUpdatedAt: now, kind: "terminal", agentId: "codex", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 1 },
  { chatId: "chat-3", projectRoot: "/home/dev/widgets", title: "Slider refactor", titleSource: "user", titleUpdatedAt: now, kind: "terminal", agentId: "claudeCode", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 },
];
// Chat ids referenced by installFlatChatListFixture — its busy/attention
// seeding must match these exactly.
export const FLAT_CHAT_LIST_NEEDS_YOU_ID = "chat-flat-needsyou";
export const FLAT_CHAT_LIST_WORKING_ID = "chat-flat-working";
const FLAT_CHAT_LIST_EXTRA_CHATS: Chat[] = [
  { chatId: FLAT_CHAT_LIST_NEEDS_YOU_ID, projectRoot: "/home/dev/widgets", title: "PR monitoring agent flow", titleSource: "user", titleUpdatedAt: now, kind: "agent", agentId: "codex", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 5 },
  { chatId: FLAT_CHAT_LIST_WORKING_ID, projectRoot: "/home/dev/acme-app", title: "Sidebar waiting state", titleSource: "user", titleUpdatedAt: now, kind: "agent", agentId: "claudeCode", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 5 },
  { chatId: "chat-flat-quiet-old", projectRoot: "/home/dev/widgets", title: "Local usage analytics plan", titleSource: "user", titleUpdatedAt: now, kind: "terminal", agentId: "pi", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now - 2 * 86_400_000, sortOrder: 6 },
];
const SAMPLE_PICKS = [
  { id: 1, projectRoot: "/home/dev/acme-app", widgetClass: "LoginButton", creationFile: "lib/login.dart", creationLine: 42, skillId: "s", agentId: "claudeCode", terminalId: "t", chatId: null, pickedAt: now, widgetContextJson: "{}" },
];
const SAMPLE_RUNS = [
  { sessionId: "run-1", projectRoot: "/home/dev/acme-app", startedAt: now, endedAt: now + 9000, avdId: null, avdName: "Pixel_10", serial: "emulator-5554", vmServiceUrl: null, targetFile: "lib/main.dart", connectionMode: "auto", exitReason: "done", exitCode: 0, hotReloadCount: 7, hotRestartCount: 1, errorCount: 0, lastError: null },
];

function agentChatFixtureEnabled(): boolean {
  try {
    return localStorage.getItem(VRT_AGENT_CHAT_FIXTURE_KEY) === "1";
  } catch {
    return false;
  }
}

function agentChatContextOverflowFixtureEnabled(): boolean {
  try {
    return localStorage.getItem(VRT_AGENT_CHAT_CONTEXT_OVERFLOW_KEY) === "1";
  } catch {
    return false;
  }
}

/** The default fixture's usage row, with contextUsed pushed past
 * contextWindow — renders ContextMeter's warn state (#307). */
function agentChatHistoryForFixture(): AgentTimelineEntry[] {
  if (!agentChatContextOverflowFixtureEnabled()) return AGENT_CHAT_HISTORY;
  return AGENT_CHAT_HISTORY.map((entry) => {
    if (entry.entryType !== "item" || entry.kind !== "usage") return entry;
    const usage = JSON.parse(entry.payload) as AgentEvent;
    return {
      ...entry,
      payload: JSON.stringify({ ...usage, contextUsed: 1_230_000, contextWindow: 1_000_000 }),
    };
  });
}

function flatChatListFixtureEnabled(): boolean {
  try {
    return localStorage.getItem(VRT_FLAT_CHAT_LIST_FIXTURE_KEY) === "1";
  } catch {
    return false;
  }
}

function flatChatListLoadErrorRoot(): string | null {
  try {
    return localStorage.getItem(VRT_FLAT_CHAT_LIST_LOAD_ERROR_KEY);
  } catch {
    return null;
  }
}

function chatsForProject(projectRoot: unknown) {
  if (flatChatListLoadErrorRoot() === projectRoot) {
    throw new Error(`mock chats_list failure for ${String(projectRoot)}`);
  }
  let chats = SAMPLE_CHATS.filter((c) => c.projectRoot === projectRoot);
  if (flatChatListFixtureEnabled()) {
    chats = [...chats, ...FLAT_CHAT_LIST_EXTRA_CHATS.filter((c) => c.projectRoot === projectRoot)];
  }
  if (!agentChatFixtureEnabled() || projectRoot !== AGENT_CHAT_FIXTURE.projectRoot) {
    return chats;
  }
  return [AGENT_CHAT_FIXTURE, ...chats];
}

function item(seq: number, event: AgentEvent): AgentTimelineEntry {
  return {
    entryType: "item",
    seq,
    kind: event.kind,
    payload: JSON.stringify(event),
    createdAt: now,
  };
}

const AGENT_CHAT_HISTORY: AgentTimelineEntry[] = [
  {
    entryType: "message",
    seq: 1,
    role: "user",
    content: "Stabilize the structured agent chat UI for visual regression.",
    createdAt: now,
  },
  item(2, { kind: "turnStarted" }),
  item(3, {
    kind: "thinkingFinal",
    itemId: "thinking-1",
    text: "Review fixture coverage, keep the surface deterministic, and verify that completed turns leave the composer idle.",
  }),
  item(4, {
    kind: "textDelta",
    text: "Built a deterministic VRT fixture for the structured chat surface. ",
  }),
  item(5, {
    kind: "textFinal",
    itemId: "assistant-1",
    text: "Built a deterministic VRT fixture for the structured chat surface. It covers the **message flow**, completed tool work, file changes, planning, and token usage without live streaming state.\n\n## Markdown coverage\n\n- Inline `code` and *emphasis*\n- A fenced block:\n\n```ts\nconst snapshot = await page.screenshot();\n```",
  }),
  item(6, {
    kind: "commandStarted",
    itemId: "cmd-1",
    command: "bun run vrt -- tests/vrt/agent-chat.spec.ts",
    cwd: "/home/dev/acme-app",
  }),
  item(7, {
    kind: "commandDone",
    itemId: "cmd-1",
    exitCode: 0,
    status: "completed",
    outputTail: "1 passed (2.4s)\nSnapshot written: agent-chat.png\nNo visual diffs found",
  }),
  item(8, {
    kind: "fileChange",
    itemId: "files-1",
    changes: [
      { path: "src/lib/tauriMock.ts", kind: "modify", diff: null },
      { path: "tests/vrt/agent-chat.spec.ts", kind: "add", diff: null },
    ],
  }),
  item(9, {
    kind: "planUpdate",
    items: [
      { text: "Mock a representative persisted timeline", status: "completed" },
      { text: "Capture the idle composer state", status: "completed" },
      { text: "Run the full validation gate", status: "inProgress" },
      { text: "Write up the release notes", status: "pending" },
    ],
  }),
  item(10, {
    kind: "usage",
    inputTokens: 18420,
    cachedInputTokens: 4096,
    outputTokens: 2310,
    costUsd: 0.0873,
    contextUsed: 32410,
    contextWindow: 1_000_000,
  }),
  item(11, { kind: "turnDone", status: "completed" }),
];

const MOCK_ORCHESTRA_TASKS: { id: string; projectRoot: string }[] = [];

const MOCK_USAGE_SUMMARY = [
  { provider: "claudeCode", model: "claude-haiku-4-5", chats: 2, turns: 14, inputTokens: 48210, cachedInputTokens: 21050, outputTokens: 9640, costUsd: 0.31 },
  { provider: "codex", model: "gpt-5.3-codex-spark", chats: 1, turns: null, inputTokens: 22400, cachedInputTokens: 8000, outputTokens: 4120, costUsd: 0 },
];
let MOCK_TELEMETRY = { crash_reports: true };
// hostPlatform() resolves "linux" for the plain-Chromium userAgent Playwright
// runs under (no Macintosh/Windows markers), so the Linux-only graphics
// section (#238) renders in VRT the same as it would on a real Linux build —
// this mock backs it with deterministic fixture data instead of the `null`
// default fallback (which would render an error state).
let MOCK_LINUX_GRAPHICS = { mode: "auto" as const, recommendation_dismissed: false };
// Frozen at its initial value, like the real boot-applied mode is — only a
// (mocked) relaunch would change what "boot" means, never a plain
// linux_graphics_set call. Lets a VRT spec exercise the restart-required
// notice by selecting a mode that differs from this.
const MOCK_LINUX_GRAPHICS_BOOT_MODE: typeof MOCK_LINUX_GRAPHICS.mode = MOCK_LINUX_GRAPHICS.mode;
let MOCK_REMOTE_RUNNING = false;
let MOCK_REMOTE_PAIRING: { code: string; createdAtMs: number; expiresAtMs: number; usedAtMs: number | null }[] = [];

function remoteOverview() {
  return {
    running: MOCK_REMOTE_RUNNING,
    listener: MOCK_REMOTE_RUNNING
      ? { kind: "loopback", host: "127.0.0.1", port: 4747 }
      : { kind: "disabled" },
    localUrl: MOCK_REMOTE_RUNNING ? "http://127.0.0.1:4747" : null,
    authPath: "/home/dev/.pickforge/remote-auth.json",
    pairingCodes: MOCK_REMOTE_PAIRING,
    clients: [],
    tailscale: {
      available: true,
      binaryPath: "/usr/bin/tailscale",
      version: "1.98.8",
      backendState: "Running",
      online: true,
      hostName: "acme-host",
      dnsName: "acme-host.tailnet.ts.net.",
      tailscaleIps: ["100.64.0.10"],
      sshCapable: true,
      sshEnabled: false,
      error: null,
    },
    defaultHost: "127.0.0.1",
    defaultPort: 4747,
  };
}

/** Mirrors the Rust DB's monotonic title-ownership rule: an automatic
 * (provider) title may replace the current one only if the chat is already
 * auto-owned, or still carries the untouched "New chat" default/legacy
 * sentinel. */
function autoTitleMayReplace(chat: Chat): boolean {
  return (
    chat.titleSource === "auto" ||
    (chat.titleSource === "default" && chat.title === "New chat") ||
    (chat.titleSource === "user" && chat.titleUpdatedAt === 0 && chat.title === "New chat")
  );
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  orchestra_task_upsert: (a) => {
    const task = a.task as { id: string; projectRoot: string };
    const index = MOCK_ORCHESTRA_TASKS.findIndex((t) => t.id === task.id);
    if (index >= 0) MOCK_ORCHESTRA_TASKS[index] = task;
    else MOCK_ORCHESTRA_TASKS.push(task);
    return null;
  },
  orchestra_task_delete: (a) => {
    const index = MOCK_ORCHESTRA_TASKS.findIndex((t) => t.id === a.id);
    if (index >= 0) MOCK_ORCHESTRA_TASKS.splice(index, 1);
    return null;
  },
  orchestra_tasks_list: (a) =>
    MOCK_ORCHESTRA_TASKS.filter((t) => t.projectRoot === a.projectRoot),
  agent_usage_summary: () => MOCK_USAGE_SUMMARY,
  projects_list: () => projectsForFixture(),
  chats_list: (a) => chatsForProject(a.projectRoot),
  chat_upsert: (a) => {
    const chat = a.chat as Chat;
    const index = SAMPLE_CHATS.findIndex((item) => item.chatId === chat.chatId);
    if (index >= 0) SAMPLE_CHATS[index] = { ...chat };
    else SAMPLE_CHATS.push({ ...chat });
    return null;
  },
  update_chat_title: (a) => {
    const chat = SAMPLE_CHATS.find((item) => item.chatId === a.chatId);
    if (!chat) return false;
    const source = a.titleSource;
    const updatedAt = a.titleUpdatedAt;
    if (source === undefined && updatedAt === undefined) {
      chat.title = String(a.title);
      return true;
    }
    if (
      (source !== "default" && source !== "auto" && source !== "user") ||
      typeof updatedAt !== "number"
    ) {
      throw new Error("titleSource and titleUpdatedAt must be supplied together");
    }
    if (updatedAt <= chat.titleUpdatedAt) return false;
    if (source === "auto" && !autoTitleMayReplace(chat)) return false;
    chat.title = String(a.title);
    chat.titleSource = source;
    chat.titleUpdatedAt = updatedAt;
    return true;
  },
  update_chat_title_ownership: (a) => {
    const chat = SAMPLE_CHATS.find((item) => item.chatId === a.chatId);
    if (!chat) return false;
    const updatedAt = Number(a.titleUpdatedAt);
    if (updatedAt <= chat.titleUpdatedAt) return false;
    chat.titleSource = a.titleSource as Chat["titleSource"];
    chat.titleUpdatedAt = updatedAt;
    return true;
  },
  update_chat_agent: (a) => {
    const chat = SAMPLE_CHATS.find((item) => item.chatId === a.chatId);
    if (!chat) return null;
    chat.agentId = String(a.agentId);
    chat.kind = String(a.kind);
    return null;
  },
  telemetry_get: () => MOCK_TELEMETRY,
  telemetry_set: (a) => {
    MOCK_TELEMETRY = { crash_reports: a.crashReports !== false };
    return null;
  },
  linux_graphics_get: () => MOCK_LINUX_GRAPHICS,
  linux_graphics_set: (a) => {
    MOCK_LINUX_GRAPHICS = { ...MOCK_LINUX_GRAPHICS, mode: a.mode as typeof MOCK_LINUX_GRAPHICS.mode };
    return null;
  },
  linux_graphics_boot_mode_get: () => MOCK_LINUX_GRAPHICS_BOOT_MODE,
  linux_graphics_recommendation_get: () => false,
  linux_graphics_recommendation_dismiss: () => {
    MOCK_LINUX_GRAPHICS = { ...MOCK_LINUX_GRAPHICS, recommendation_dismissed: true };
    return null;
  },
  detect_binaries: (a) => (a.names as string[]).map(() => true),
  remote_host_status: () => remoteOverview(),
  remote_host_start: () => {
    MOCK_REMOTE_RUNNING = true;
    return remoteOverview();
  },
  remote_host_stop: () => {
    MOCK_REMOTE_RUNNING = false;
    return remoteOverview();
  },
  remote_host_issue_pairing_code: () => {
    const code = {
      code: "2345-6789-ABCD-EFGH",
      createdAtMs: now,
      expiresAtMs: now + 600_000,
      usedAtMs: null,
    };
    MOCK_REMOTE_PAIRING = [code];
    return code;
  },
  remote_host_revoke_client: () => null,
  remote_tailscale_ssh_set: () => remoteOverview().tailscale,
  project_remote_set: () => null,
  project_remote_clear: () => null,
  remote_host_health: () => ({
    checkedAtMs: now,
    tailnet: { state: "ok" },
    ssh: { state: "ok" },
    daemon: { state: "failed", reason: "pickforged not reachable" },
  }),
  remote_flutter_devices: () => {
    const fixture = remoteDeviceFixture();
    if (fixture === "loading") return new Promise(() => {});
    if (fixture === "error") return Promise.reject(new Error("SSH unavailable"));
    if (fixture === "empty") return [];
    return [
      {
        id: "chrome",
        name: "Chrome",
        isSupported: true,
        emulator: false,
      },
      {
        id: "macos",
        name: "macOS",
        isSupported: true,
        emulator: false,
      },
    ];
  },
  remote_nearest_pubspec: () => "/home/dev/acme-app",
  remote_detect_binaries: (a) => (a.names as string[]).map(() => true),
  target_detect: () => ({ targetId: "flutter", displayName: "Flutter", confidence: "exact", priority: 100, capabilities: ["detect", "launch", "hotReload", "captureScreenshot", "streamLogs", "inspectSelection"] }),
  adb_list_devices: () => [{ serial: "emulator-5554", state: "device", model: "Pixel_10" }],
  android_device_list: () => [
    { serial: "emulator-5554", avdId: "Pixel_10", displayName: "Pixel 10", state: "running", kind: "emulator" },
    { serial: null, avdId: "Pixel_4a", displayName: "Pixel 4a", state: "stopped", kind: "emulator" },
  ],
  android_launch_avd: () => null,
  android_wait_for_device: () => true,
  ios_device_list: () => [
    { serial: "SIM-9F3A-1D7B", avdId: null, displayName: "iPhone 17 Pro (iOS 26.5)", state: "running", kind: "simulator" },
  ],
  ios_boot_device: () => null,
  ios_screenshot: () => null,
  ios_dump_accessibility: () => ({
    nodeId: "0",
    role: "unknown",
    className: "Application",
    text: null,
    contentDescription: null,
    resourceId: null,
    bounds: { left: 0, top: 0, right: 390, bottom: 844 },
    enabled: true,
    clickable: false,
    selected: false,
    children: [
      {
        nodeId: "1",
        role: "text",
        className: "StaticText",
        text: "Welcome to PickForge",
        contentDescription: null,
        resourceId: null,
        bounds: { left: 24, top: 120, right: 366, bottom: 160 },
        enabled: true,
        clickable: false,
        selected: false,
        children: [],
      },
      {
        nodeId: "2",
        role: "button",
        className: "Button",
        text: "Continue",
        contentDescription: "Continue",
        resourceId: "fixture-button",
        bounds: { left: 24, top: 720, right: 366, bottom: 776 },
        enabled: true,
        clickable: true,
        selected: false,
        children: [],
      },
    ],
  }),
  oslog_start: () => null,
  oslog_stop: () => null,
  find_nearest_pubspec: () => null,
  picks_list: () => SAMPLE_PICKS,
  pick_insert: () => 1,
  run_insert: () => null,
  run_finish: () => null,
  agent_run_insert: () => 1,
  runs_list: () => SAMPLE_RUNS,
  list_dir: () => [
    { name: "lib", path: "/home/dev/acme-app/lib", isDir: true },
    { name: "pubspec.yaml", path: "/home/dev/acme-app/pubspec.yaml", isDir: false },
  ],
  project_touch: () => null,
  vm_status: () => null,
  mcp_start: (a) => ({
    endpoint: "/run/pickforge-vrt/agent.sock",
    contextDir: `${a.projectRoot}/.pickforge`,
    runsDir: `${a.projectRoot}/.pickforge/runs`,
    chatsDir: `${a.projectRoot}/.pickforge/chats`,
    mcpConfigPath: `${a.projectRoot}/.pickforge/pickforge-mcp.json`,
    mcpCommand: "pickforge-mcp",
  }),
  mcp_publish_state: () => null,
  mcp_push_log: () => null,
  mcp_run_started: () => null,
  mcp_take_swarm_requests: () => [],
  mcp_update_swarm_run: () => null,
  mcp_swarm_status: () => ({ runs: [] }),
  mcp_stop: () => null,
  list_pi_kit_runs: () => [],
  abandon_pi_kit_lane: () => ({ requested: true, consumed: false }),
  write_forge_context: () => null,
  clear_forge_context: () => null,
  picklab_status: () => ({
    cliAvailable: true,
    mcpAvailable: true,
    cliPath: "/usr/bin/picklab",
    mcpPath: "/usr/bin/picklab-mcp",
    version: "0.1.3",
    doctor: { ok: true, checks: [] },
    agents: { ok: true, agents: [] },
    error: null,
  }),
  probe_agent_cli: (args) => {
    if (args.agentId === "omp") {
      return {
        installed: true,
        versionOutput: "omp 17.1.1",
        helpOutput: [
          "Usage: omp [options] [command] [prompt...]",
          "      --no-extensions                 Disable extension discovery",
          "  acp           Run Oh My Pi as an ACP (Agent Client Protocol) server over stdio",
        ].join("\n"),
        modelsOutput: OMP_MODELS_FIXTURE,
        errors: [],
      };
    }
    if (args.agentId === "codex") {
      return {
        installed: true,
        versionOutput: "codex-cli 0.144.6",
        helpOutput: "Usage: codex [OPTIONS] [PROMPT]",
        modelsOutput: CODEX_MODELS_FIXTURE,
        errors: [],
      };
    }
    return {
      installed: true,
      versionOutput: "pi 0.79.10",
      helpOutput: "pi [--profile <name>] [--provider <id>]",
      modelsOutput: [
        "Provider Model Context",
        "anthropic claude-sonnet-4-6 200k",
        "openai gpt-5.4 128k",
      ].join("\n"),
      errors: [],
    };
  },
  probe_agent_auth: (args) =>
    args.agentId === "codex"
      ? { state: "authenticated" }
      : { state: "notAuthenticated" },
  agent_chat_history: (a) =>
    a.chatId === AGENT_CHAT_FIXTURE.chatId ? agentChatHistoryForFixture() : [],
  agent_chat_start: (a) => `vrt-session-${a.chatId}`,
  agent_chat_send: () => null,
  agent_chat_interrupt: () => null,
  "plugin:app|version": () => "0.1.0",
  open_path: () => null,
  open_external_url: () => null,
  git_status: () => ({
    isRepo: true,
    branch: "main",
    files: [
      { path: "lib/login.dart", status: " M", staged: false, unstaged: true, untracked: false },
      { path: "lib/new_widget.dart", status: "??", staged: false, unstaged: true, untracked: true },
      { path: "README.md", status: "A ", staged: true, unstaged: false, untracked: false },
    ],
  }),
  git_diff: () =>
    "diff --git a/lib/login.dart b/lib/login.dart\n@@ -1,3 +1,3 @@\n-old line\n+new line\n context\n",
  git_discover_repos: (a) => [a.projectRoot],
  // #231 PR3's `changesReview` flag-off VRT scenario asserts this never
  // fires — a simple call counter is the cheapest way to prove "no fetch"
  // from Playwright without a real network/IPC layer to inspect.
  changes_list_turn_change_sets: (a) => {
    const globals = window as unknown as Record<string, unknown>;
    globals.__PICKFORGE_VRT_CHANGES_LIST_CALLS__ =
      ((globals.__PICKFORGE_VRT_CHANGES_LIST_CALLS__ as number) ?? 0) + 1;
    return a.chatId === AGENT_CHAT_FIXTURE.chatId ? [CHANGES_TURN_FIXTURE(a.projectRoot as string)] : [];
  },
  changes_turn_file_diff: (a) => changesHardStateFileDiff(a),
  changes_working_tree: (a) => CHANGES_WORKING_TREE_FIXTURE(a.projectRoot as string),
  changes_working_tree_file_diff: (a) => changesHardStateFileDiff(a),
};

export function installTauriMock() {
  const globals = window as unknown as Record<string, unknown>;
  globals.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      const run = () => Promise.resolve(HANDLERS[cmd] ? HANDLERS[cmd](args) : null);
      if (cmd !== "probe_agent_cli") return run();
      if (globals.__PICKFORGE_VRT_FAIL_OMP_PROBE__ === true && args.agentId === "omp") {
        globals.__PICKFORGE_VRT_FAIL_OMP_PROBE__ = false;
        return Promise.reject(new Error("OMP compatibility probe unavailable"));
      }
      return run();
    },
    transformCallback: (cb: unknown) => cb,
    convertFileSrc: (p: string) => p,
  };
}
