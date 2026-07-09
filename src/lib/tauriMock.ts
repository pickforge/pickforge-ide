// VRT-only Tauri mock. When VITE_PICKFORGE_VRT=1, install a fake
// window.__TAURI_INTERNALS__ so the app renders with sample data in a plain
// browser (Playwright), with no Tauri runtime.
import type { AgentEvent, AgentTimelineEntry } from "./agentChat";

const now = 1_750_000_000_000;
const VRT_AGENT_CHAT_FIXTURE_KEY = "pickforge.vrt.agentChatFixture";

const AGENT_CHAT_FIXTURE = { chatId: "chat-agent-vrt", projectRoot: "/home/dev/acme-app", title: "Structured chat fixture", kind: "agent", agentId: "codex", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 };

const SAMPLE_PROJECTS = [
  { projectRoot: "/home/dev/acme-app", displayName: "acme-app", createdAt: now, lastOpenedAt: now, sortOrder: 0, archivedAt: null },
  { projectRoot: "/home/dev/widgets", displayName: "widgets", createdAt: now, lastOpenedAt: now, sortOrder: 1, archivedAt: null },
];
const SAMPLE_CHATS = [
  { chatId: "chat-1", projectRoot: "/home/dev/acme-app", title: "Login screen", kind: "terminal", agentId: "claudeCode", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 },
  { chatId: "chat-2", projectRoot: "/home/dev/acme-app", title: "Settings polish", kind: "terminal", agentId: "codex", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 1 },
  { chatId: "chat-3", projectRoot: "/home/dev/widgets", title: "Slider refactor", kind: "terminal", agentId: "claudeCode", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 },
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

function chatsForProject(projectRoot: unknown) {
  const chats = SAMPLE_CHATS.filter((c) => c.projectRoot === projectRoot);
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
      { text: "Mock a representative persisted timeline", completed: true },
      { text: "Capture the idle composer state", completed: true },
      { text: "Run the full validation gate", completed: false },
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
  projects_list: () => SAMPLE_PROJECTS,
  chats_list: (a) => chatsForProject(a.projectRoot),
  settings_get: () => null,
  telemetry_get: () => MOCK_TELEMETRY,
  telemetry_set: (a) => {
    MOCK_TELEMETRY = { crash_reports: a.crashReports !== false };
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
  agent_run_finish: () => null,
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
  agent_chat_history: (a) => a.chatId === AGENT_CHAT_FIXTURE.chatId ? AGENT_CHAT_HISTORY : [],
  agent_chat_start: (a) => `vrt-session-${a.chatId}`,
  agent_chat_send: () => null,
  agent_chat_interrupt: () => null,
  "plugin:app|version": () => "0.1.0",
  open_path: () => null,
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
};

export function installTauriMock() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) =>
      Promise.resolve(HANDLERS[cmd] ? HANDLERS[cmd](args) : null),
    transformCallback: (cb: unknown) => cb,
    convertFileSrc: (p: string) => p,
  };
}
