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
  return { mem, session, engine };
});

vi.mock("../../src/lib/proAuth", () => ({
  getProSupabaseClient: () => ({}) as unknown,
}));

vi.mock("../../src/stores/account", () => ({
  accountSession: () => env.session.current,
}));

vi.mock("@pickforge/sync", async (importActual) => {
  const actual = await importActual<typeof import("@pickforge/sync")>();
  return { ...actual, pullGroup: env.engine.pullGroup, pushGroup: env.engine.pushGroup };
});

const USER_ID = "11111111-1111-4111-8111-111111111111";

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
  const store = await import("../../src/stores/settingsSyncStore");
  return { flags, store };
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

  it("round-trips keybindings from the quick-launch store", async () => {
    const s = await loadSerializers();
    const ql = await import("../../src/stores/quickLaunch");

    const payload = s.collectKeybindings();
    ql.setQuickLaunchItems([{ id: "temp", label: "temp", hotkey: null }]);
    s.applyKeybindings(payload);
    expect(s.collectKeybindings()).toEqual(payload);
  });

  it("keys remoteBindings by basename with no absolute local project paths", async () => {
    const s = await loadSerializers();
    const payload = s.collectRemoteBindings([
      { projectRoot: "/home/dev/Projects/Pickforge", remoteHost: "forge", remoteRoot: "/srv/pickforge" },
      { projectRoot: "/home/dev/work/api/", remoteHost: "box", remoteRoot: "/opt/api" },
      { projectRoot: "/home/dev/local-only", remoteHost: null, remoteRoot: null },
    ]);

    const bindings = (payload as Record<string, any>).bindings;
    expect(Object.keys(bindings).sort()).toEqual(["Pickforge", "api"]);
    expect(bindings.Pickforge).toEqual({ remoteHost: "forge", remoteRoot: "/srv/pickforge" });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("/home/dev");
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
    s.applyKeybindings({ v: 1, items: [] } as any);
    s.applyKeybindings({ v: 1, items: [{ label: "no id" }] } as any);
    expect(s.collectKeybindings()).toEqual(before);
    // The store still holds the default items (nothing was wiped).
    expect(ql.quickLaunchItems().length).toBeGreaterThan(0);
  });

  it("applies remote bindings only to locally-unbound projects", async () => {
    const s = await loadSerializers();
    const calls: Array<[string, string, string]> = [];
    await s.applyRemoteBindings(
      { v: 1, bindings: { Pickforge: { remoteHost: "forge", remoteRoot: "/srv/pf" }, api: { remoteHost: "box", remoteRoot: "/opt/api" } } } as any,
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
    expect(env.engine.pullGroup).not.toHaveBeenCalled();
    expect(env.engine.pushGroup).not.toHaveBeenCalled();
  });

  it("opts in and pushes each enabled group when the server is empty", async () => {
    const { flags, store } = await loadStore();
    flags.setFlagOverride("settingsSync", true);
    env.session.current = { userId: USER_ID };
    // Keep remoteBindings out so the workspace/db graph is never loaded.
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
    store.setSettingsSyncGroup("operatorConfig", false);
    store.setSettingsSyncGroup("keybindings", false);
    store.setSettingsSyncGroup("remoteBindings", false);

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
});
