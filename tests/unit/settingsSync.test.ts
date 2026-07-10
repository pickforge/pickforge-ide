import { beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeSyncPayload, type SyncRecord } from "@pickforge/sync";

// Stores read localStorage and theme touches document at apply time; both must
// exist before the (hoisted) store imports run under the node test env.
const env = vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  (globalThis as Record<string, unknown>).document = {
    documentElement: { dataset: {} as Record<string, string> },
  };
  const session = { current: null as { userId: string } | null };
  const engine = { pullGroup: vi.fn(), pushGroup: vi.fn() };
  const workspace = {
    setState: (() => {}) as (...args: unknown[]) => void,
    state: null as unknown as { loaded: boolean; projects: unknown[] },
  };
  return { mem, session, engine, workspace };
});

vi.mock("../../src/lib/proAuth", () => ({
  getProSupabaseClient: () => ({}) as unknown,
}));

vi.mock("../../src/stores/account", () => ({
  accountSession: () => env.session.current,
}));

vi.mock("../../src/stores/workspace", async () => {
  const { createStore } = await import("solid-js/store");
  const [state, setState] = createStore({ loaded: true, projects: [] as unknown[] });
  env.workspace = { state, setState: setState as (...args: unknown[]) => void };
  return { workspace: state, setProjectRemoteLocal: vi.fn() };
});

vi.mock("@pickforge/sync", async (importActual) => {
  const actual = await importActual<typeof import("@pickforge/sync")>();
  return { ...actual, pullGroup: env.engine.pullGroup, pushGroup: env.engine.pushGroup };
});

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_ID = USER_A;

beforeEach(() => {
  env.mem.clear();
  vi.clearAllMocks();
  env.session.current = null;
  env.engine.pullGroup.mockResolvedValue(null);
  env.engine.pushGroup.mockResolvedValue({
    status: "written",
    record: { fieldGroup: "appSettings", payload: {}, updatedAt: "2026-01-01T00:00:00.000000Z" },
  });
});

async function loadSerializers() {
  vi.resetModules();
  return import("../../src/lib/settingsSync");
}

async function loadStore() {
  vi.resetModules();
  const flags = await import("../../src/stores/flags");
  // Instantiate the workspace mock up front so tests can flip `loaded`.
  await import("../../src/stores/workspace");
  const store = await import("../../src/stores/settingsSyncStore");
  return { flags, store };
}

function onlyAppSettings(store: Awaited<ReturnType<typeof loadStore>>["store"]) {
  store.setSettingsSyncGroup("operatorConfig", false);
  store.setSettingsSyncGroup("keybindings", false);
  store.setSettingsSyncGroup("remoteBindings", false);
}

const flushTasks = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("settingsSync serializers", () => {
  it("round-trips appSettings", async () => {
    const s = await loadSerializers();
    const theme = await import("../../src/stores/theme");
    const workbench = await import("../../src/stores/workbenchPrefs");
    const controls = await import("../../src/stores/windowControls");

    theme.applyTheme("light");
    workbench.setRunButtonLabels(true);
    controls.setWindowControlsSide("right");
    const payload = s.collectAppSettings();
    expect(payload).toEqual({
      v: 1,
      theme: "light",
      runButtonLabels: true,
      windowControlsSide: "right",
    });

    theme.applyTheme("dark");
    workbench.setRunButtonLabels(false);
    controls.setWindowControlsSide("auto");
    s.applyAppSettings(payload);
    expect(s.collectAppSettings()).toEqual(payload);
  });

  it("round-trips operatorConfig and excludes the absolute modelPath", async () => {
    const s = await loadSerializers();
    const router = await import("../../src/stores/operatorRouterSettings");
    const voice = await import("../../src/stores/voiceSettings");

    router.setOperatorRouterBackend("codex");
    router.setOperatorRouterModel("codex", "gpt-5-mini");
    voice.setVoiceMicEnabled(false);
    voice.setVoicePushToCommand(true);
    voice.setVoiceModelPath("/home/dev/models/ggml-base.bin");

    const payload = s.collectOperatorConfig();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("modelPath");
    expect(serialized).not.toContain("/home/dev/models/ggml-base.bin");
    expect((payload as Record<string, unknown>).router).toMatchObject({ backend: "codex" });

    router.setOperatorRouterBackend("off");
    voice.setVoiceMicEnabled(true);
    voice.setVoicePushToCommand(false);
    s.applyOperatorConfig(payload);

    const restored = s.collectOperatorConfig() as Record<string, any>;
    expect(restored.router.backend).toBe("codex");
    expect(restored.router.models.codex).toBe("gpt-5-mini");
    expect(restored.dictation).toEqual({ micEnabled: false, pushToCommand: true });
  });

  it("round-trips the hosted router backend through sync", async () => {
    const s = await loadSerializers();
    const router = await import("../../src/stores/operatorRouterSettings");

    router.setOperatorRouterBackend("hosted");
    const payload = s.collectOperatorConfig();
    expect((payload as Record<string, any>).router.backend).toBe("hosted");

    router.setOperatorRouterBackend("off");
    s.applyOperatorConfig(payload);
    expect((s.collectOperatorConfig() as Record<string, any>).router.backend).toBe("hosted");
  });

  it("round-trips keybindings from the quick-launch store", async () => {
    const s = await loadSerializers();
    const ql = await import("../../src/stores/quickLaunch");

    const payload = s.collectKeybindings();
    ql.setQuickLaunchItems([{ id: "temp", label: "temp", hotkey: null }]);
    s.applyKeybindings(payload);
    expect(s.collectKeybindings()).toEqual(payload);
  });

  it("carries remoteBindings by basename with no absolute local project paths", async () => {
    const s = await loadSerializers();
    const payload = s.collectRemoteBindings([
      { projectRoot: "/home/dev/Projects/Pickforge", remoteHost: "forge", remoteRoot: "/srv/pickforge" },
      { projectRoot: "/home/dev/work/api/", remoteHost: "box", remoteRoot: "/opt/api" },
      { projectRoot: "/home/dev/local-only", remoteHost: null, remoteRoot: null },
    ]);

    expect((payload as Record<string, any>).v).toBe(2);
    expect((payload as Record<string, any>).bindings).toEqual([
      { project: "Pickforge", remoteHost: "forge", remoteRoot: "/srv/pickforge" },
      { project: "api", remoteHost: "box", remoteRoot: "/opt/api" },
    ]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("/home/dev");
  });

  it("syncs a project whose basename looks like a secret key", async () => {
    const s = await loadSerializers();
    // Basenames are payload VALUES (v2 array), never map keys — the sanitizer's
    // denied-key pattern would reject "api-key-notes" as a key.
    const payload = s.collectRemoteBindings([
      { projectRoot: "/home/dev/api-key-notes", remoteHost: "forge", remoteRoot: "/srv/notes" },
    ]);
    expect(() => sanitizeSyncPayload("remoteBindings", payload)).not.toThrow();

    const calls: Array<[string, string, string]> = [];
    await s.applyRemoteBindings(payload, {
      projects: [{ projectRoot: "/other/api-key-notes", remoteHost: null, remoteRoot: null }],
      setBinding: (root, host, remoteRoot) => void calls.push([root, host, remoteRoot]),
    });
    expect(calls).toEqual([["/other/api-key-notes", "forge", "/srv/notes"]]);
  });

  it("still applies legacy v1 remoteBindings payloads", async () => {
    const s = await loadSerializers();
    const calls: Array<[string, string, string]> = [];
    await s.applyRemoteBindings(
      { v: 1, bindings: { Pickforge: { remoteHost: "forge", remoteRoot: "/srv/pf" } } } as any,
      {
        projects: [{ projectRoot: "/home/dev/Projects/Pickforge", remoteHost: null, remoteRoot: null }],
        setBinding: (root, host, remoteRoot) => void calls.push([root, host, remoteRoot]),
      },
    );
    expect(calls).toEqual([["/home/dev/Projects/Pickforge", "forge", "/srv/pf"]]);
  });

  it("passes the real sanitizeSyncPayload for every collected group", async () => {
    const s = await loadSerializers();
    const router = await import("../../src/stores/operatorRouterSettings");
    router.setOperatorRouterModel("ollama", "qwen2.5:3b");

    expect(() => sanitizeSyncPayload("appSettings", s.collectAppSettings())).not.toThrow();
    expect(() => sanitizeSyncPayload("operatorConfig", s.collectOperatorConfig())).not.toThrow();
    expect(() => sanitizeSyncPayload("keybindings", s.collectKeybindings())).not.toThrow();
    expect(() =>
      sanitizeSyncPayload(
        "remoteBindings",
        s.collectRemoteBindings([
          { projectRoot: "/home/dev/Projects/Pickforge", remoteHost: "forge", remoteRoot: "/srv/pickforge" },
        ]),
      ),
    ).not.toThrow();
  });

  it("ignores junk and unknown-version payloads in apply()", async () => {
    const s = await loadSerializers();
    const theme = await import("../../src/stores/theme");
    const ql = await import("../../src/stores/quickLaunch");

    theme.applyTheme("dark");
    s.applyAppSettings(null as unknown as any);
    s.applyAppSettings("garbage" as unknown as any);
    s.applyAppSettings({ v: 2, theme: "light" } as any);
    s.applyAppSettings({ v: 1, theme: "chartreuse" } as any);
    expect(theme.appTheme()).toBe("dark");

    const before = s.collectKeybindings();
    s.applyKeybindings({ v: 1, items: "nope" } as any);
    s.applyKeybindings({ v: 1, items: [{ label: "no id" }] } as any);
    expect(s.collectKeybindings()).toEqual(before);
    // The store still holds the default items (nothing was wiped).
    expect(ql.quickLaunchItems().length).toBeGreaterThan(0);
  });

  it("applies an empty keybindings list as a valid all-chips-deleted state", async () => {
    const s = await loadSerializers();
    const ql = await import("../../src/stores/quickLaunch");

    expect(ql.quickLaunchItems().length).toBeGreaterThan(0);
    s.applyKeybindings({ v: 1, items: [] } as any);
    expect(ql.quickLaunchItems()).toEqual([]);

    // The deletion survives a reload — the versioned persisted blob marks the
    // empty list as explicit, not missing.
    vi.resetModules();
    const reloaded = await import("../../src/stores/quickLaunch");
    expect(reloaded.quickLaunchItems()).toEqual([]);
  });

  it("applies remote bindings only to locally-unbound projects", async () => {
    const s = await loadSerializers();
    const calls: Array<[string, string, string]> = [];
    await s.applyRemoteBindings(
      {
        v: 2,
        bindings: [
          { project: "Pickforge", remoteHost: "forge", remoteRoot: "/srv/pf" },
          { project: "api", remoteHost: "box", remoteRoot: "/opt/api" },
        ],
      } as any,
      {
        projects: [
          { projectRoot: "/home/dev/Projects/Pickforge", remoteHost: null, remoteRoot: null },
          { projectRoot: "/home/dev/work/api", remoteHost: "already", remoteRoot: "/here" },
        ],
        setBinding: (root, host, remoteRoot) => void calls.push([root, host, remoteRoot]),
      },
    );
    // Pickforge was unbound → adopted; api was already bound locally → left alone.
    expect(calls).toEqual([["/home/dev/Projects/Pickforge", "forge", "/srv/pf"]]);
  });
});

describe("settingsSync engine", () => {
  it("no-ops when the flag is off", async () => {
    const { store } = await loadStore();
    env.session.current = { userId: USER_ID };
    await store.sync();
    expect(env.engine.pullGroup).not.toHaveBeenCalled();
    expect(env.engine.pushGroup).not.toHaveBeenCalled();
  });

  it("no-ops when signed out even with the flag on", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = null;
    store.setSettingsSyncOptIn(true);
    await store.sync();
    expect(store.settingsSyncState().optedIn).toBe(false);
    expect(env.engine.pullGroup).not.toHaveBeenCalled();
    expect(env.engine.pushGroup).not.toHaveBeenCalled();
  });

  it("opts in and pushes each enabled group when the server is empty", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    store.setSettingsSyncGroup("remoteBindings", false);

    store.setSettingsSyncOptIn(true);
    await store.sync();

    const pushedGroups = env.engine.pushGroup.mock.calls.map((c) => c[0].group).sort();
    expect(pushedGroups).toEqual(["appSettings", "keybindings", "operatorConfig"]);
    expect(store.settingsSyncState().optedIn).toBe(true);
  });

  it("adopts the server value on a stale pull instead of pushing", async () => {
    const { flags, store } = await loadStore();
    const theme = await import("../../src/stores/theme");
    theme.applyTheme("dark");

    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    onlyAppSettings(store);

    const serverRecord: SyncRecord = {
      fieldGroup: "appSettings",
      payload: { v: 1, theme: "light", runButtonLabels: true, windowControlsSide: "right" },
      updatedAt: "2999-01-01T00:00:00.000000Z",
    };
    env.engine.pullGroup.mockResolvedValue(serverRecord);

    store.setSettingsSyncOptIn(true);
    await store.sync();

    expect(theme.appTheme()).toBe("light");
    expect(env.engine.pushGroup).not.toHaveBeenCalled();
  });

  it("scopes opt-in, groups, and meta per user", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);

    env.session.current = { userId: USER_A };
    store.setSettingsSyncGroup("keybindings", false);
    store.setSettingsSyncOptIn(true);
    await store.sync();
    expect(store.settingsSyncState().optedIn).toBe(true);
    expect(env.mem.has(`pickforge.settingsSync.${USER_A}`)).toBe(true);
    expect(env.mem.has(`pickforge.settingsSync.${USER_A}.meta`)).toBe(true);

    // User B on the same machine starts fresh — no inherited opt-in, groups,
    // or content hashes.
    env.session.current = { userId: USER_B };
    expect(store.settingsSyncState().optedIn).toBe(false);
    expect(store.settingsSyncState().groups.keybindings).toBe(true);
    expect(env.mem.has(`pickforge.settingsSync.${USER_B}`)).toBe(false);
    expect(env.mem.has(`pickforge.settingsSync.${USER_B}.meta`)).toBe(false);
    store.setSettingsSyncGroup("appSettings", false);
    expect(store.settingsSyncState().groups.appSettings).toBe(false);

    // A's blob survives sign-out/sign-in cycles untouched by B's edits.
    env.session.current = { userId: USER_A };
    expect(store.settingsSyncState().optedIn).toBe(true);
    expect(store.settingsSyncState().groups.appSettings).toBe(true);
    expect(store.settingsSyncState().groups.keybindings).toBe(false);
  });

  it("does not bump last-synced when every group fails", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    onlyAppSettings(store);
    env.engine.pullGroup.mockRejectedValue(new Error("offline"));

    store.setSettingsSyncOptIn(true);
    await store.sync();

    expect(store.lastSyncedRelative()).toBeNull();
    expect(store.settingsSyncErrorMessage()).toBe("Settings sync hit a snag — it will retry.");

    env.engine.pullGroup.mockResolvedValue(null);
    await store.sync();
    expect(store.lastSyncedRelative()).toBe("just now");
    expect(store.settingsSyncErrorMessage()).toBeNull();
  });

  it("waits for the workspace to load before syncing", async () => {
    const { flags, store } = await loadStore();
    env.workspace.setState("loaded", false);
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    onlyAppSettings(store);

    store.setSettingsSyncOptIn(true);
    const done = store.sync();
    await flushTasks();
    expect(env.engine.pullGroup).not.toHaveBeenCalled();

    env.workspace.setState("loaded", true);
    await done;
    expect(env.engine.pullGroup).toHaveBeenCalled();
  });

  it("stamps pushes with the edit time, not the sync time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
      const { flags, store } = await loadStore();
      const theme = await import("../../src/stores/theme");
      flags.setFlagOverride("settingsSync", true);
      env.session.current = { userId: USER_ID };
      onlyAppSettings(store);
      store.setSettingsSyncOptIn(true);
      await store.sync();
      expect(env.engine.pushGroup.mock.calls.length).toBe(1);

      vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
      theme.applyTheme("light");

      vi.setSystemTime(new Date("2026-01-02T05:00:00Z"));
      await store.sync();

      expect(env.engine.pushGroup.mock.calls.length).toBe(2);
      const push = env.engine.pushGroup.mock.calls.at(-1)![0];
      expect(push.updatedAt.startsWith("2026-01-02T01:00:00")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loses to a server write newer than the local edit (edit-time LWW)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
      const { flags, store } = await loadStore();
      const theme = await import("../../src/stores/theme");
      theme.applyTheme("light");
      flags.setFlagOverride("settingsSync", true);
      env.session.current = { userId: USER_ID };
      onlyAppSettings(store);
      store.setSettingsSyncOptIn(true);
      await store.sync();
      expect(env.engine.pushGroup.mock.calls.length).toBe(1);

      // This machine edits at 01:00 but doesn't sync yet…
      vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
      theme.applyTheme("dark");

      // …and another machine wrote the group at 02:00.
      env.engine.pullGroup.mockResolvedValue({
        fieldGroup: "appSettings",
        payload: { v: 1, theme: "light", runButtonLabels: true, windowControlsSide: "left" },
        updatedAt: "2026-01-02T02:00:00.000000Z",
      } satisfies SyncRecord);

      // Syncing at 05:00 must NOT let the stale 01:00 edit beat the 02:00 write.
      vi.setSystemTime(new Date("2026-01-02T05:00:00Z"));
      await store.sync();

      expect(theme.appTheme()).toBe("light");
      expect(env.engine.pushGroup.mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the remaining groups when the user opts out mid-run", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    store.setSettingsSyncGroup("keybindings", false);
    store.setSettingsSyncGroup("remoteBindings", false);
    env.engine.pullGroup.mockImplementation(async ({ group }: { group: string }) => {
      if (group === "appSettings") store.setSettingsSyncOptIn(false);
      return null;
    });

    store.setSettingsSyncOptIn(true);
    await store.sync();

    // appSettings was already in flight; operatorConfig must not run.
    expect(env.engine.pullGroup.mock.calls.map((c) => c[0].group)).toEqual(["appSettings"]);
  });

  it("skips a group toggled off mid-run", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    store.setSettingsSyncGroup("keybindings", false);
    store.setSettingsSyncGroup("remoteBindings", false);
    env.engine.pullGroup.mockImplementation(async ({ group }: { group: string }) => {
      if (group === "appSettings") store.setSettingsSyncGroup("operatorConfig", false);
      return null;
    });

    store.setSettingsSyncOptIn(true);
    await store.sync();

    expect(env.engine.pullGroup.mock.calls.map((c) => c[0].group)).toEqual(["appSettings"]);
    // The rest of the run stayed alive — the group was skipped, not the sync.
    expect(store.lastSyncedRelative()).toBe("just now");
  });

  it("coalesces a group toggled on during a run into one follow-up run", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    onlyAppSettings(store);

    const gate = deferred<null>();
    env.engine.pullGroup.mockImplementation(({ group }: { group: string }) =>
      group === "appSettings" ? gate.promise : Promise.resolve(null),
    );

    store.setSettingsSyncOptIn(true);
    await flushTasks();
    expect(env.engine.pullGroup.mock.calls.map((c) => c[0].group)).toEqual(["appSettings"]);

    // Toggled on while the appSettings run is blocked — must not be dropped.
    store.setSettingsSyncGroup("operatorConfig", true);
    gate.resolve(null);

    await vi.waitFor(() => {
      expect(env.engine.pullGroup.mock.calls.map((c) => c[0].group)).toEqual([
        "appSettings",
        "operatorConfig",
      ]);
    });
  });
});
