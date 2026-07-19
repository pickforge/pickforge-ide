import { describe, expect, it, vi } from "vitest";

// runTargets reaches Tauri only inside async discovery (via ./device); stub it so
// importing the pure command-builder functions never touches the Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const remote = vi.hoisted(() => ({
  nearestPubspec: vi.fn(),
  binaries: vi.fn(),
  pubspecUsesFlutter: vi.fn(),
}));

vi.mock("../../src/lib/remoteHost", () => ({
  remoteNearestPubspec: remote.nearestPubspec,
  remoteDetectBinaries: remote.binaries,
  remotePubspecUsesFlutter: remote.pubspecUsesFlutter,
}));

import { invoke } from "@tauri-apps/api/core";
import {
  defaultCommand,
  discoverRemoteRunTargets,
  discoverRunTargetsForProject,
  expandVars,
  fromLaunchConfig,
  hasCapability,
  isCompatibleDevice,
  isDirProgram,
  isLogcatTarget,
  isTestProgram,
  logSourceOf,
  runProfile,
  RunTargetDiscovery,
  shquote,
  stripJsonc,
  supportTier,
  withDevice,
  type RunTarget,
} from "../../src/lib/runTargets";

const target = (over: Partial<RunTarget>): RunTarget => ({
  id: "detected",
  label: "x",
  command: "flutter --color run",
  capabilities: [],
  needsDevice: true,
  deviceConvention: "arg",
  inspectorKind: "vmService",
  logSource: "pty",
  source: "detected",
  ...over,
});

describe("defaultCommand", () => {
  const cmd = (targetId: string) => defaultCommand({ targetId } as never);
  it("maps each framework, null for generic", () => {
    expect(cmd("flutter")).toBe("flutter --color run");
    expect(cmd("react-native")).toBe("npx react-native run-android");
    expect(cmd("native-android")).toBe("./gradlew installDebug");
    expect(cmd("native-ios")).toBe("xcodebuild build");
    expect(cmd("web")).toBe("npm run dev");
    expect(cmd("generic")).toBeNull();
  });
});

describe("discoverRemoteRunTargets", () => {
  it("uses the Flutter app found below a Dart workspace root and requires deterministic device selection", async () => {
    remote.nearestPubspec.mockResolvedValue("/srv/repo/apps/app");
    remote.binaries.mockResolvedValue([true]);
    remote.pubspecUsesFlutter.mockResolvedValue(true);

    await expect(
      discoverRemoteRunTargets({ host: "mac-mini", remoteRoot: "/srv/repo" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "remote-flutter",
        command: "flutter --color run",
        cwd: "/srv/repo/apps/app",
        capabilities: expect.not.arrayContaining(["captureScreenshot"]),
        needsDevice: true,
        inspectorKind: "vmService",
      }),
    ]);

    expect(remote.nearestPubspec).toHaveBeenCalledWith("mac-mini", "/srv/repo");
    expect(remote.pubspecUsesFlutter).toHaveBeenCalledWith("mac-mini", "/srv/repo/apps/app");
    expect(remote.binaries).toHaveBeenCalledWith("mac-mini", ["flutter"]);
  });

  it("surfaces an honest error when Flutter is unavailable on the host", async () => {
    remote.nearestPubspec.mockResolvedValue("/srv/app");
    remote.binaries.mockResolvedValue([false]);
    remote.pubspecUsesFlutter.mockResolvedValue(true);

    await expect(
      discoverRemoteRunTargets({ host: "mac-mini", remoteRoot: "/srv/app" }),
    ).rejects.toThrow("Flutter is not available on remote host mac-mini");
  });

  it("rejects a remote Dart package without the Flutter SDK dependency", async () => {
    remote.nearestPubspec.mockResolvedValue("/srv/app");
    remote.pubspecUsesFlutter.mockResolvedValue(false);
    remote.binaries.mockResolvedValue([true]);

    await expect(
      discoverRemoteRunTargets({ host: "mac-mini", remoteRoot: "/srv/app" }),
    ).rejects.toThrow("Remote project at /srv/app is not a Flutter app");
  });

  it("drops stale discovery results after the binding changes for the same project", async () => {
    let resolveOld!: (value: string) => void;
    let resolveFresh!: (value: string) => void;
    const oldPubspec = new Promise<string>((resolve) => { resolveOld = resolve; });
    const freshPubspec = new Promise<string>((resolve) => { resolveFresh = resolve; });
    remote.nearestPubspec.mockImplementation((host: string) =>
      host === "old-host" ? oldPubspec : freshPubspec);
    remote.binaries.mockResolvedValue([true]);
    remote.pubspecUsesFlutter.mockResolvedValue(true);
    const discovery = new RunTargetDiscovery();

    const stale = discovery.discover("/local/app", {
      host: "old-host",
      remoteRoot: "/srv/old",
    });
    const fresh = discovery.discover("/local/app", {
      host: "new-host",
      remoteRoot: "/srv/new",
    });

    resolveFresh("/srv/new/app");
    await expect(fresh).resolves.toEqual({
      targets: [expect.objectContaining({ cwd: "/srv/new/app" })],
      error: null,
    });
    resolveOld("/srv/old/app");
    await expect(stale).resolves.toBeNull();
  });
});

describe("discoverRunTargetsForProject", () => {
  it("never falls back to local detection when a remotely bound project's discovery fails", async () => {
    remote.nearestPubspec.mockRejectedValue(new Error("ssh unavailable"));
    vi.mocked(invoke).mockClear();

    await expect(
      discoverRunTargetsForProject("/local/app", { host: "mac-mini", remoteRoot: "/srv/app" }),
    ).rejects.toThrow("ssh unavailable");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses local detection only for an unbound project", async () => {
    vi.mocked(invoke).mockClear();
    remote.nearestPubspec.mockClear();

    await discoverRunTargetsForProject("/local/app", null);

    expect(invoke).toHaveBeenCalled();
    expect(remote.nearestPubspec).not.toHaveBeenCalled();
  });
});

describe("runProfile", () => {
  it("flutter → arg + vmService + pty logs", () => {
    expect(runProfile("flutter")).toEqual({
      needsDevice: true,
      deviceConvention: "arg",
      inspectorKind: "vmService",
      logSource: "pty",
    });
  });
  it("react-native → rnDevice + uiAutomator + logcat logs", () => {
    expect(runProfile("react-native")).toEqual({
      needsDevice: true,
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    });
  });
  it("native-android → env + uiAutomator + logcat logs", () => {
    expect(runProfile("native-android")).toEqual({
      needsDevice: true,
      deviceConvention: "env",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    });
  });
  it("native-ios → xcodeDestination + iosAccessibility inspector + oslog logs", () => {
    expect(runProfile("native-ios")).toEqual({
      needsDevice: true,
      deviceConvention: "xcodeDestination",
      inspectorKind: "iosAccessibility",
      logSource: "oslog",
    });
  });
  it("web → none device + cdp + pty logs", () => {
    expect(runProfile("web")).toEqual({
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "cdp",
      logSource: "pty",
    });
  });
  it("generic / unknown → none + none + pty logs", () => {
    expect(runProfile("generic")).toEqual({
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "none",
      logSource: "pty",
    });
  });
});

describe("logSource derivations", () => {
  // isLogcatTarget must keep IDENTICAL behavior for every existing target now
  // that it derives from logSource instead of the inspector kind.
  it("isLogcatTarget is true only for logcat-source targets", () => {
    expect(isLogcatTarget(target({ logSource: "logcat" }))).toBe(true);
    expect(isLogcatTarget(target({ logSource: "pty" }))).toBe(false);
    expect(isLogcatTarget(target({ logSource: "oslog" }))).toBe(false);
    expect(isLogcatTarget(null)).toBe(false);
    expect(isLogcatTarget(undefined)).toBe(false);
  });
  it("logSourceOf defaults an absent/null target to the run PTY", () => {
    expect(logSourceOf(null)).toBe("pty");
    expect(logSourceOf(undefined)).toBe("pty");
    expect(logSourceOf(target({ logSource: "logcat" }))).toBe("logcat");
    expect(logSourceOf(target({ logSource: "oslog" }))).toBe("oslog");
  });
  it("derives each adapter's log source from its profile", () => {
    expect(runProfile("flutter").logSource).toBe("pty");
    expect(runProfile("react-native").logSource).toBe("logcat");
    expect(runProfile("native-android").logSource).toBe("logcat");
    expect(runProfile("native-ios").logSource).toBe("oslog");
    expect(runProfile("web").logSource).toBe("pty");
  });
});

describe("supportTier", () => {
  // The capability vectors are the real ones declared per adapter in
  // crates/pickforge-core/src/targets/adapters.rs.
  const flutter = [
    "detect", "launch", "stop", "hotReload", "hotRestart",
    "captureScreenshot", "streamLogs", "inspectSelection",
    "mapSelectionToSource", "exposeMcpTools",
  ];
  const reactNative = ["detect", "launch", "stop", "captureScreenshot", "streamLogs", "inspectSelection"];
  const nativeAndroid = ["detect", "launch", "captureScreenshot", "streamLogs", "inspectSelection"];
  const nativeIos = ["detect", "launch", "captureScreenshot", "streamLogs", "inspectSelection"];
  const web = ["detect", "captureScreenshot", "inspectSelection", "mapSelectionToSource"];
  const generic = ["detect"];

  it("Flutter (source mapping + run + inspect) → deep", () => {
    expect(supportTier(target({ capabilities: flutter }))).toBe("deep");
  });
  it("React Native / native-Android (run + inspect, no source map) → useful", () => {
    expect(supportTier(target({ capabilities: reactNative }))).toBe("useful");
    expect(supportTier(target({ capabilities: nativeAndroid }))).toBe("useful");
  });
  it("native-iOS (run + inspect via idb, no source map) → useful", () => {
    expect(supportTier(target({ capabilities: nativeIos }))).toBe("useful");
  });
  it("Web (inspect, no launch) → experimental — thin runtime", () => {
    expect(supportTier(target({ capabilities: web }))).toBe("experimental");
  });
  it("Generic (detect-only) and null → manual", () => {
    expect(supportTier(target({ capabilities: generic }))).toBe("manual");
    expect(supportTier(null)).toBe("manual");
  });
  it("undefined capabilities → manual, no throw", () => {
    const t = target({ capabilities: undefined as never });
    expect(() => supportTier(t)).not.toThrow();
    expect(supportTier(t)).toBe("manual");
    expect(() => hasCapability(t, "inspectSelection")).not.toThrow();
    expect(hasCapability(t, "inspectSelection")).toBe(false);
  });
  it("hasCapability reads the vector", () => {
    expect(hasCapability(target({ capabilities: reactNative }), "inspectSelection")).toBe(true);
    expect(hasCapability(target({ capabilities: reactNative }), "mapSelectionToSource")).toBe(false);
    expect(hasCapability(null, "inspectSelection")).toBe(false);
  });
});

describe("withDevice", () => {
  it("flutter appends -d <serial>", () => {
    expect(
      withDevice(target({ deviceConvention: "arg", command: "flutter --color run" }), "emulator-5556"),
    ).toBe("flutter --color run -d 'emulator-5556'");
  });
  it("flutter leaves an already-pinned device alone", () => {
    expect(
      withDevice(target({ deviceConvention: "arg", command: "flutter run -d chrome" }), "emulator-5556"),
    ).toBe("flutter run -d chrome");
  });
  it("react-native pins ANDROID_SERIAL + --deviceId", () => {
    expect(
      withDevice(target({ deviceConvention: "rnDevice", command: "npx react-native run-android" }), "emulator-5556"),
    ).toBe("ANDROID_SERIAL='emulator-5556' npx react-native run-android --deviceId 'emulator-5556'");
  });
  it("native-android prefixes ANDROID_SERIAL", () => {
    expect(
      withDevice(target({ deviceConvention: "env", command: "./gradlew installDebug" }), "emulator-5556"),
    ).toBe("ANDROID_SERIAL='emulator-5556' ./gradlew installDebug");
  });
  it("native-ios expands the build into a build→install→launch pipeline pinned to the udid", () => {
    // A bare `xcodebuild build` only compiles; the pipeline builds a SIMULATOR
    // .app (`-sdk iphonesimulator` — a destination alone builds the device SDK,
    // which simctl can't install), resolves the freshly-built app, then installs
    // + launches it on the sim so the RUNNING app is what the inspector/screenshot
    // sees. The udid is pinned at install + launch (a simulator build is
    // device-agnostic; the specific device is chosen there).
    expect(
      withDevice(
        target({ deviceConvention: "xcodeDestination", command: "xcodebuild build" }),
        "SIM-9F3A-1D7B",
      ),
    ).toBe(
      "xcodebuild build -configuration Debug -sdk iphonesimulator SYMROOT=build/pickforge-ios && " +
        "APP=\"$(ls -d build/pickforge-ios/Debug-iphonesimulator/*.app | head -1)\" && " +
        "xcrun simctl install 'SIM-9F3A-1D7B' \"$APP\" && " +
        "xcrun simctl launch 'SIM-9F3A-1D7B' \"$(plutil -extract CFBundleIdentifier raw \"$APP/Info.plist\")\"",
    );
  });
  it("native-ios leaves an already-pinned -destination alone", () => {
    expect(
      withDevice(
        target({
          deviceConvention: "xcodeDestination",
          command: "xcodebuild build -destination 'id=OTHER'",
        }),
        "SIM-9F3A-1D7B",
      ),
    ).toBe("xcodebuild build -destination 'id=OTHER'");
  });
  it("native-ios: -destination-timeout is NOT a pinned destination (token-aware)", () => {
    // A near-miss flag must not be mistaken for `-destination`, or the chosen
    // udid would be silently dropped and the pipeline never built. The user's
    // extra flag is preserved verbatim ahead of the appended destination.
    expect(
      withDevice(
        target({
          deviceConvention: "xcodeDestination",
          command: "xcodebuild build -destination-timeout 30",
        }),
        "SIM-9F3A-1D7B",
      ),
    ).toBe(
      "xcodebuild build -destination-timeout 30 -configuration Debug " +
        "-sdk iphonesimulator SYMROOT=build/pickforge-ios && " +
        "APP=\"$(ls -d build/pickforge-ios/Debug-iphonesimulator/*.app | head -1)\" && " +
        "xcrun simctl install 'SIM-9F3A-1D7B' \"$APP\" && " +
        "xcrun simctl launch 'SIM-9F3A-1D7B' \"$(plutil -extract CFBundleIdentifier raw \"$APP/Info.plist\")\"",
    );
  });
  it("native-ios: -destination as the trailing token still counts as pinned", () => {
    expect(
      withDevice(
        target({ deviceConvention: "xcodeDestination", command: "xcodebuild -destination" }),
        "SIM-9F3A-1D7B",
      ),
    ).toBe("xcodebuild -destination");
  });
});

describe("isCompatibleDevice", () => {
  const flutter = target({ deviceConvention: "arg" });
  const reactNative = target({ deviceConvention: "rnDevice" });
  const nativeAndroid = target({ deviceConvention: "env" });
  const nativeIos = target({ deviceConvention: "xcodeDestination" });
  const web = target({ deviceConvention: "none", needsDevice: false });

  it("native-iOS accepts only simulators", () => {
    expect(isCompatibleDevice(nativeIos, "simulator")).toBe(true);
    expect(isCompatibleDevice(nativeIos, "emulator")).toBe(false);
    expect(isCompatibleDevice(nativeIos, "physical")).toBe(false);
  });
  it("adb-backed targets (RN / native-Android) accept emulators/physical, never simulators", () => {
    for (const t of [reactNative, nativeAndroid]) {
      expect(isCompatibleDevice(t, "emulator")).toBe(true);
      expect(isCompatibleDevice(t, "physical")).toBe(true);
      expect(isCompatibleDevice(t, "simulator")).toBe(false);
    }
  });
  it("flutter accepts every kind (flutter -d takes adb serials and sim udids)", () => {
    expect(isCompatibleDevice(flutter, "emulator")).toBe(true);
    expect(isCompatibleDevice(flutter, "physical")).toBe(true);
    expect(isCompatibleDevice(flutter, "simulator")).toBe(true);
  });
  it("no-device / null targets are unconstrained", () => {
    expect(isCompatibleDevice(web, "simulator")).toBe(true);
    expect(isCompatibleDevice(null, "emulator")).toBe(true);
    expect(isCompatibleDevice(undefined, "simulator")).toBe(true);
  });
  it("ignores the serial for none / no-device / null", () => {
    expect(
      withDevice(target({ deviceConvention: "none", needsDevice: false, command: "npm run dev" }), "emulator-5556"),
    ).toBe("npm run dev");
    expect(withDevice(target({ deviceConvention: "arg", command: "flutter run" }), null)).toBe("flutter run");
  });
});

describe("shquote", () => {
  it("single-quotes and escapes inner quotes", () => {
    expect(shquote("a b")).toBe("'a b'");
    expect(shquote("it's")).toBe("'it'\\''s'");
  });
});

describe("stripJsonc", () => {
  it("strips line + block comments and trailing commas", () => {
    const src = `{
      // a comment
      "a": 1, /* block */
      "b": [1, 2,],
    }`;
    expect(JSON.parse(stripJsonc(src))).toEqual({ a: 1, b: [1, 2] });
  });
  it("leaves commas / slashes inside strings untouched", () => {
    const src = `{ "url": "http://x/y", "csv": "a,b," }`;
    expect(JSON.parse(stripJsonc(src))).toEqual({ url: "http://x/y", csv: "a,b," });
  });
});

describe("program classification", () => {
  it("isTestProgram", () => {
    expect(isTestProgram("test/")).toBe(true);
    expect(isTestProgram("test")).toBe(true);
    expect(isTestProgram("lib/foo_test.dart")).toBe(true);
    expect(isTestProgram("lib/main.dart")).toBe(false);
  });
  it("isDirProgram", () => {
    expect(isDirProgram("app/")).toBe(true);
    expect(isDirProgram("lib/main.dart")).toBe(false);
  });
});

describe("expandVars", () => {
  it("expands workspace folder + basename", () => {
    expect(expandVars("${workspaceFolder}/lib/main.dart", "/home/u/proj")).toBe("/home/u/proj/lib/main.dart");
    expect(expandVars("${workspaceFolderBasename}", "/home/u/proj")).toBe("proj");
  });
});

describe("fromLaunchConfig", () => {
  it("a test program builds `flutter test`, not a run", async () => {
    const t = await fromLaunchConfig({ type: "dart", program: "test/", cwd: "/p" }, 0, "/p");
    expect(t?.command.startsWith("flutter test")).toBe(true);
    expect(t?.capabilities).toContain("test");
    expect(t?.needsDevice).toBe(false);
  });
  it("a run program builds `flutter run` with the vmService profile", async () => {
    const t = await fromLaunchConfig({ type: "dart", program: "lib/main.dart", cwd: "/p" }, 0, "/p");
    expect(t?.command.startsWith("flutter run")).toBe(true);
    expect(t?.inspectorKind).toBe("vmService");
    expect(t?.deviceConvention).toBe("arg");
    expect(t?.needsDevice).toBe(true);
  });
  it("a non-flutter program has no inspector or device convention", async () => {
    const t = await fromLaunchConfig({ type: "node", program: "server.js" }, 0, "/p");
    expect(t?.inspectorKind).toBe("none");
    expect(t?.deviceConvention).toBe("none");
    expect(t?.needsDevice).toBe(false);
  });
  it("a Flutter run config is deep-tier with VM-service inspection + source mapping", async () => {
    const t = await fromLaunchConfig({ type: "dart", program: "lib/main.dart", cwd: "/p" }, 0, "/p");
    expect(t?.capabilities).toContain("inspectSelection");
    expect(t?.capabilities).toContain("mapSelectionToSource");
    expect(supportTier(t)).toBe("deep");
  });
  it("a non-Flutter run config keeps its prior (experimental) tier — runnable, no inspect", async () => {
    const t = await fromLaunchConfig({ type: "node", program: "server.js" }, 0, "/p");
    expect(t?.capabilities).toEqual(["launch", "stop"]);
    expect(t?.capabilities).not.toContain("inspectSelection");
    expect(supportTier(t)).toBe("experimental");
  });
  it("a release Flutter config is bare launch/stop — no VM service to inspect or hot reload", async () => {
    const t = await fromLaunchConfig(
      { type: "dart", program: "lib/main.dart", cwd: "/p", flutterMode: "release" },
      0,
      "/p",
    );
    expect(t?.command).toContain("--release");
    expect(t?.capabilities).toEqual(["launch", "stop"]);
    expect(t?.capabilities).not.toContain("inspectSelection");
    expect(t?.capabilities).not.toContain("mapSelectionToSource");
    expect(t?.capabilities).not.toContain("hotReload");
    expect(t?.capabilities).not.toContain("hotRestart");
    expect(t?.inspectorKind).toBe("none");
    expect(supportTier(t)).not.toBe("deep");
  });
  it("a profile Flutter config keeps hot restart but not hot reload or inspection", async () => {
    const t = await fromLaunchConfig(
      { type: "dart", program: "lib/main.dart", cwd: "/p", flutterMode: "profile" },
      0,
      "/p",
    );
    expect(t?.command).toContain("--profile");
    expect(t?.capabilities).toEqual(["launch", "hotRestart", "stop"]);
    expect(t?.capabilities).not.toContain("hotReload");
    expect(t?.capabilities).not.toContain("inspectSelection");
    expect(t?.capabilities).not.toContain("mapSelectionToSource");
    expect(t?.inspectorKind).toBe("none");
    expect(supportTier(t)).not.toBe("deep");
  });
  it("a default (debug) Flutter config stays deep with the full live caps", async () => {
    const t = await fromLaunchConfig({ type: "dart", program: "lib/main.dart", cwd: "/p" }, 0, "/p");
    expect(t?.capabilities).toEqual([
      "launch", "hotReload", "hotRestart", "stop", "inspectSelection", "mapSelectionToSource",
    ]);
    expect(t?.inspectorKind).toBe("vmService");
    expect(supportTier(t)).toBe("deep");
  });
  it("an explicit debug Flutter config matches the default (debug) caps", async () => {
    const t = await fromLaunchConfig(
      { type: "dart", program: "lib/main.dart", cwd: "/p", flutterMode: "debug" },
      0,
      "/p",
    );
    expect(t?.command).toContain("--debug");
    expect(t?.capabilities).toContain("inspectSelection");
    expect(t?.capabilities).toContain("mapSelectionToSource");
    expect(t?.inspectorKind).toBe("vmService");
    expect(supportTier(t)).toBe("deep");
  });
});
