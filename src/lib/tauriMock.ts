// VRT-only Tauri mock. When VITE_PICKFORGE_VRT=1, install a fake
// window.__TAURI_INTERNALS__ so the app renders with sample data in a plain
// browser (Playwright), with no Tauri runtime.

const now = 1_750_000_000_000;

const SAMPLE_PROJECTS = [
  { projectRoot: "/home/dev/acme-app", displayName: "acme-app", createdAt: now, lastOpenedAt: now, sortOrder: 0, archivedAt: null },
  { projectRoot: "/home/dev/widgets", displayName: "widgets", createdAt: now, lastOpenedAt: now, sortOrder: 1, archivedAt: null },
];
const SAMPLE_CHATS = [
  { chatId: "chat-1", projectRoot: "/home/dev/acme-app", title: "Login screen", agentId: "claudeCode", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 0 },
  { chatId: "chat-2", projectRoot: "/home/dev/acme-app", title: "Settings polish", agentId: "codex", skillId: null, sessionId: null, labelsJson: null, status: null, taskBriefText: null, createdAt: now, lastActivityAt: now, sortOrder: 1 },
];
const SAMPLE_PICKS = [
  { id: 1, projectRoot: "/home/dev/acme-app", widgetClass: "LoginButton", creationFile: "lib/login.dart", creationLine: 42, skillId: "s", agentId: "claudeCode", terminalId: "t", chatId: null, pickedAt: now, widgetContextJson: "{}" },
];
const SAMPLE_RUNS = [
  { sessionId: "run-1", projectRoot: "/home/dev/acme-app", startedAt: now, endedAt: now + 9000, avdId: null, avdName: "Pixel_10", serial: "emulator-5554", vmServiceUrl: null, targetFile: "lib/main.dart", connectionMode: "auto", exitReason: "done", exitCode: 0, hotReloadCount: 7, hotRestartCount: 1, errorCount: 0, lastError: null },
];

const HANDLERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  projects_list: () => SAMPLE_PROJECTS,
  chats_list: () => SAMPLE_CHATS,
  settings_get: () => null,
  detect_binaries: (a) => (a.names as string[]).map(() => true),
  target_detect: () => ({ targetId: "flutter", displayName: "Flutter", confidence: "exact", priority: 100, capabilities: ["detect", "launch", "hotReload", "captureScreenshot", "streamLogs", "inspectSelection"] }),
  adb_list_devices: () => [{ serial: "emulator-5554", state: "device", model: "Pixel_10" }],
  picks_list: () => SAMPLE_PICKS,
  runs_list: () => SAMPLE_RUNS,
  list_dir: () => [
    { name: "lib", path: "/home/dev/acme-app/lib", isDir: true },
    { name: "pubspec.yaml", path: "/home/dev/acme-app/pubspec.yaml", isDir: false },
  ],
  project_touch: () => null,
  vm_status: () => null,
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
};

export function installTauriMock() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: Record<string, unknown> = {}) =>
      Promise.resolve(HANDLERS[cmd] ? HANDLERS[cmd](args) : null),
    transformCallback: (cb: unknown) => cb,
    convertFileSrc: (p: string) => p,
  };
}
