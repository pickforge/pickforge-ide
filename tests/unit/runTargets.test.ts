import { describe, expect, it, vi } from "vitest";

// runTargets reaches Tauri only inside async discovery (via ./device); stub it so
// importing the pure command-builder functions never touches the Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  defaultCommand,
  expandVars,
  fromLaunchConfig,
  isDirProgram,
  isTestProgram,
  runProfile,
  shquote,
  stripJsonc,
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
  source: "detected",
  ...over,
});

describe("defaultCommand", () => {
  const cmd = (targetId: string) => defaultCommand({ targetId } as never);
  it("maps each framework, null for generic", () => {
    expect(cmd("flutter")).toBe("flutter --color run");
    expect(cmd("react-native")).toBe("npx react-native run-android");
    expect(cmd("native-android")).toBe("./gradlew installDebug");
    expect(cmd("web")).toBe("npm run dev");
    expect(cmd("generic")).toBeNull();
  });
});

describe("runProfile", () => {
  it("flutter → arg + vmService", () => {
    expect(runProfile("flutter")).toEqual({
      needsDevice: true,
      deviceConvention: "arg",
      inspectorKind: "vmService",
    });
  });
  it("react-native → rnDevice + uiAutomator", () => {
    expect(runProfile("react-native")).toEqual({
      needsDevice: true,
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
    });
  });
  it("native-android → env + uiAutomator", () => {
    expect(runProfile("native-android")).toEqual({
      needsDevice: true,
      deviceConvention: "env",
      inspectorKind: "uiAutomator",
    });
  });
  it("web → none device + cdp", () => {
    expect(runProfile("web")).toEqual({
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "cdp",
    });
  });
  it("generic / unknown → none + none", () => {
    expect(runProfile("generic")).toEqual({
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "none",
    });
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
});
