// Run-target discovery: the detected project target (Flutter / React Native /
// Android / Web) plus any `.vscode/launch.json` configurations. Targets are run
// by typing a command into the focused terminal (PTY); hot reload / restart /
// stop are keystrokes the running tool reads from stdin — so no new runner.
import { invoke } from "@tauri-apps/api/core";
import { findNearestPubspec, targetDetect, type TargetDetection } from "./device";
import type { RemotePty } from "./pty";
import {
  remoteDetectBinaries,
  remoteNearestPubspec,
  remotePubspecUsesFlutter,
} from "./remoteHost";

/** How the chosen device serial is applied to a target's command — decided once
 *  per adapter instead of re-sniffed from the command string at each call site.
 *  "arg" → append `-d <serial>` (flutter); "rnDevice" → `ANDROID_SERIAL=` +
 *  `--deviceId <serial>` (react-native); "env" → prefix `ANDROID_SERIAL=`
 *  (native-android); "none" → ignore the serial. */
export type DeviceConvention = "arg" | "rnDevice" | "env" | "xcodeDestination" | "none";
/** Which inspector the right rail should use for a target. */
export type InspectorKind = "vmService" | "uiAutomator" | "cdp" | "iosAccessibility" | "none";
/** Where a target's device logs surface: the run PTY (Flutter / web / generic),
 *  Android `adb logcat` (React Native / native-Android), or iOS `os_log`
 *  (native-iOS). Drives whether the Debug Console shows a Logs tab and which
 *  stream client feeds it. */
export type LogSource = "pty" | "logcat" | "oslog";

export interface RunTarget {
  id: string;
  label: string;
  /** command typed at the prompt (without a trailing newline) */
  command: string;
  /** absolute dir to run the command in (a single `cd` is applied at run time);
   *  undefined means "use the project root". */
  cwd?: string;
  /** capability strings: "hotReload" | "hotRestart" | "stop" | "launch" … */
  capabilities: string[];
  /** flutter/android targets accept a device serial */
  needsDevice: boolean;
  /** how a device serial is applied to `command` (see DeviceConvention). */
  deviceConvention: DeviceConvention;
  /** which inspector the right rail should use for this target. */
  inspectorKind: InspectorKind;
  /** where this target's device logs surface (see LogSource). */
  logSource: LogSource;
  source: "detected" | "vscode";
}

// Target ids match crates/pickforge-core/src/targets/adapters.rs.
export function defaultCommand(t: TargetDetection): string | null {
  switch (t.targetId) {
    case "flutter":
      // --color (global flag, before the subcommand) forces ANSI output so the
      // view-only Debug Console shows Flutter's colored logs/errors.
      return "flutter --color run";
    case "react-native":
      return "npx react-native run-android";
    case "native-android":
      return "./gradlew installDebug";
    case "native-ios":
      // The device-free base: a plain build (no simulator selected ⇒ nothing to
      // install onto). Once a simulator udid is chosen, `withDevice` expands this
      // into the full build→install→launch pipeline (see `iosRunCommand`).
      // Workspace / multi-scheme projects need -workspace/-scheme; xcodebuild
      // emits its own guidance error pointing that out rather than us guessing
      // the wrong scheme here.
      return "xcodebuild build";
    case "web":
      return "npm run dev";
    default:
      return null;
  }
}

/** Honest per-target support tier (docs/architecture/target-adapters.md):
 *  Deep = exact selection→source; Useful = run/inspect + best-effort hints;
 *  Experimental = some tooling, thin runtime; Manual = detect-only fallback. */
export type SupportTier = "deep" | "useful" | "experimental" | "manual";

const TIER_META: Record<SupportTier, { label: string; blurb: string }> = {
  deep: { label: "Deep", blurb: "Exact selection→source mapping and full run/inspect." },
  useful: { label: "Useful", blurb: "Run, logs, screenshot, inspect + best-effort source hints." },
  experimental: { label: "Experimental", blurb: "Detection + some tooling; thin runtime." },
  manual: { label: "Manual", blurb: "Terminal, attachments and prompts only — no live inspect." },
};

/** Does a target declare a capability? Capability strings are the camelCase
 *  serde names from `Capability` in adapters.rs (e.g. "inspectSelection"). */
export function hasCapability(t: RunTarget | null | undefined, cap: string): boolean {
  return (t?.capabilities ?? []).includes(cap);
}

/** Derive the support tier from a target's declared capabilities — the ONE place
 *  the capability vector is mapped to a tier, so the badge and any gating read the
 *  same honest signal. Mirrors the Deep/Useful/Experimental/Manual ladder in the
 *  docs: exact source mapping ⇒ Deep; run + inspect ⇒ Useful; any live tooling
 *  ⇒ Experimental; detect-only ⇒ Manual. */
export function supportTier(t: RunTarget | null | undefined): SupportTier {
  if (!t) return "manual";
  const caps = t.capabilities ?? [];
  const has = (c: string) => caps.includes(c);
  const inspect = has("inspectSelection");
  const runnable = has("launch");
  const tooling = runnable || has("captureScreenshot") || has("streamLogs");
  if (inspect && runnable && has("mapSelectionToSource")) return "deep";
  if (inspect && runnable) return "useful";
  if (inspect || tooling) return "experimental";
  return "manual";
}

/** The badge label + tooltip blurb for a target's tier. */
export function supportTierMeta(t: RunTarget | null | undefined): {
  tier: SupportTier;
  label: string;
  blurb: string;
} {
  const tier = supportTier(t);
  return { tier, ...TIER_META[tier] };
}

/** The per-adapter run profile — device convention + inspector kind — derived in
 *  ONE place from the detected target id, so no downstream call site re-derives
 *  "is this Flutter". `withDevice` and the inspector rail consume it. */
export interface RunProfile {
  needsDevice: boolean;
  deviceConvention: DeviceConvention;
  inspectorKind: InspectorKind;
  logSource: LogSource;
}
export function runProfile(targetId: string): RunProfile {
  switch (targetId) {
    case "flutter":
      return { needsDevice: true, deviceConvention: "arg", inspectorKind: "vmService", logSource: "pty" };
    case "react-native":
      return { needsDevice: true, deviceConvention: "rnDevice", inspectorKind: "uiAutomator", logSource: "logcat" };
    case "native-android":
      return { needsDevice: true, deviceConvention: "env", inspectorKind: "uiAutomator", logSource: "logcat" };
    case "native-ios":
      return { needsDevice: true, deviceConvention: "xcodeDestination", inspectorKind: "iosAccessibility", logSource: "oslog" };
    case "web":
      return { needsDevice: false, deviceConvention: "none", inspectorKind: "cdp", logSource: "pty" };
    default:
      return { needsDevice: false, deviceConvention: "none", inspectorKind: "none", logSource: "pty" };
  }
}

/** A target's device-log source (see LogSource). The one place the log routing
 *  is read off a target, so the Debug Console and any gating share one signal.
 *  Absent/null targets default to the PTY. */
export function logSourceOf(t: RunTarget | null | undefined): LogSource {
  return t?.logSource ?? "pty";
}

/** Whether a target's device logs live in `adb logcat` rather than the run PTY —
 *  i.e. React Native / native-Android. Flutter streams its logs into the PTY, so
 *  it (and web / iOS / unknown) is excluded. Derived from the target's log
 *  source so a new adapter inherits the Logs view from its one-line profile. */
export function isLogcatTarget(t: RunTarget | null | undefined): boolean {
  return logSourceOf(t) === "logcat";
}

/** Whether a device row can serve a target's run/tooling — the ONE place the
 *  merged (Android + iOS) device list is narrowed per target, so the picker,
 *  auto-selection and launch all agree. Keyed off the device convention (set by
 *  the per-adapter profile): xcodebuild destinations are simulator udids only;
 *  adb-backed targets (RN / native-Android) take emulators/physical only;
 *  flutter (`-d`) accepts both adb serials and sim udids; no-device targets are
 *  unconstrained (the list is informational there). */
export function isCompatibleDevice(
  t: RunTarget | null | undefined,
  kind: "emulator" | "physical" | "simulator",
): boolean {
  switch (t?.deviceConvention) {
    case "xcodeDestination":
      return kind === "simulator";
    case "rnDevice":
    case "env":
      return kind !== "simulator";
    default:
      return true;
  }
}

/** Apply the chosen device serial to a target's command per its convention.
 *  Centralised here (not regex-sniffed per call site) so a new adapter is a
 *  one-line profile change. */
export function withDevice(t: RunTarget, serial: string | null): string {
  if (!serial || !t.needsDevice) return t.command;
  switch (t.deviceConvention) {
    case "arg":
      // Flutter: append -d <serial>, unless the command already pins a device.
      return /\s-d\s/.test(t.command) ? t.command : `${t.command} -d ${shquote(serial)}`;
    case "rnDevice":
      // React Native: ANDROID_SERIAL pins adb-level ops, but the RN CLI's launch
      // loop still iterates all connected devices unless --deviceId is given, so
      // pass both to truly constrain the run to the chosen device.
      return `ANDROID_SERIAL=${shquote(serial)} ${t.command} --deviceId ${shquote(serial)}`;
    case "env":
      // native-android: prefix ANDROID_SERIAL so gradle / adb target the device.
      return `ANDROID_SERIAL=${shquote(serial)} ${t.command}`;
    case "xcodeDestination":
      // native-ios: a plain `xcodebuild build` only COMPILES — it never installs
      // or launches, so the app never lands on the sim to inspect. Expand the
      // build into a self-contained build→install→launch pipeline that builds a
      // simulator `.app` and pins the chosen udid at install + launch (see
      // `iosRunCommand`). Skip if the user already pinned a `-destination` (they
      // have taken manual control of device targeting — e.g. their own
      // `-scheme`/`-destination`), leaving their edited command untouched.
      // Token-aware: `-destination-timeout` alone must NOT count as pinned.
      return /(^|\s)-destination(\s|$)/.test(t.command)
        ? t.command
        : iosRunCommand(t.command, serial);
    default:
      return t.command;
  }
}

/** The native-iOS run pipeline: `xcodebuild` BUILDS the app for the simulator,
 *  then `simctl` INSTALLS and LAUNCHES it on the chosen simulator — a bare
 *  `xcodebuild build` only compiles, so without this the app never appears on the
 *  sim and the screenshot / os_log panels inspect whatever was already on screen.
 *
 *  Runs from the project root (the run cwd). The build pins `-sdk iphonesimulator`
 *  so a simulator `.app` is produced: `-destination 'id=<udid>'` alone does NOT
 *  work here — without a `-scheme` (which we won't guess from the project name)
 *  xcodebuild ignores the destination and builds the iphoneOS/device SDK, whose
 *  app `simctl` cannot install. `SYMROOT` steers the products into a PickForge-
 *  owned `build/` subdir so the freshly-built `.app` is locatable by glob. The
 *  bundle id is read from THAT app's Info.plist at runtime (never pre-baked) so
 *  it always matches what was just built. The udid is interpolated into install
 *  AND launch — a simulator build is device-agnostic, so the specific device is
 *  chosen only at install/launch time.
 *
 *  `base` is the build invocation (default `xcodebuild build`); xcodebuild accepts
 *  options after the action verb, so the sdk / SYMROOT flags append cleanly.
 *  Workspace / multi-scheme projects need `-workspace`/`-scheme`; there
 *  `xcodebuild build` emits its own clear guidance error for the user to edit. */
export function iosRunCommand(base: string, udid: string): string {
  const symroot = "build/pickforge-ios";
  const app = `${symroot}/Debug-iphonesimulator/*.app`;
  const id = shquote(udid);
  return [
    `${base} -configuration Debug -sdk iphonesimulator SYMROOT=${symroot}`,
    `APP="$(ls -d ${app} | head -1)"`,
    `xcrun simctl install ${id} "$APP"`,
    `xcrun simctl launch ${id} "$(plutil -extract CFBundleIdentifier raw "$APP/Info.plist")"`,
  ].join(" && ");
}

/** Convert JSONC (launch.json) to JSON: strip // and /* *​/ comments and
 *  trailing commas, which VS Code accepts. String-aware so commas/slashes
 *  inside quoted values (e.g. URLs, "a,]") are left untouched. */
export function stripJsonc(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  let inStr = false;
  let pendingComma = -1; // index in `out` of a comma awaiting a closer
  while (i < n) {
    const ch = src[i];
    if (inStr) {
      out.push(ch);
      if (ch === "\\") {
        if (i + 1 < n) out.push(src[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') { inStr = true; pendingComma = -1; out.push(ch); i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { i += 2; while (i < n && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { out.push(ch); i++; continue; }
    if (ch === ",") { out.push(ch); pendingComma = out.length - 1; i++; continue; }
    if ((ch === "}" || ch === "]") && pendingComma >= 0) { out.splice(pendingComma, 1); }
    pendingComma = -1;
    out.push(ch);
    i++;
  }
  return out.join("");
}

interface LaunchConfig {
  name?: string;
  type?: string;
  request?: string;
  program?: string;
  args?: string[];
  flutterMode?: string;
  deviceId?: string;
  cwd?: string;
}

/** Expand VS Code's workspace-folder variables (basename first — it shares the
 * ${workspaceFolder} prefix). */
export function expandVars(value: string, root: string): string {
  const base = root.replace(/[/\\]+$/, "");
  const baseName = base.split(/[/\\]/).pop() ?? "";
  return value
    .replace(/\$\{workspaceFolderBasename\}/g, baseName)
    .replace(/\$\{workspaceFolder\}/g, base);
}

/** Join a (possibly relative) path onto the project root, the way VS Code does;
 * absolute paths are returned as-is. */
function toAbsolute(p: string, root: string): string {
  const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
  if (isAbs) return p;
  const base = root.replace(/[/\\]+$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  return `${base}${sep}${p.replace(/^[/\\]+/, "")}`;
}

/** Compute `to` relative to `from` (both absolute), separator-agnostic. */
function relativePath(from: string, to: string): string {
  const sep = from.includes("\\") ? "\\" : "/";
  const fromParts = from.replace(/[/\\]+$/, "").split(/[/\\]/);
  const toParts = to.replace(/[/\\]+$/, "").split(/[/\\]/);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const up = fromParts.slice(i).map(() => "..");
  const down = toParts.slice(i);
  return [...up, ...down].join(sep) || ".";
}

/** Resolve a launch config `cwd` to an absolute path: expand the workspace
 * variables, then join relative values onto the project root. */
function resolveCwd(cwd: string, root: string): string {
  return toAbsolute(expandVars(cwd, root), root);
}

/** A test program — a `test/` dir or a `*_test.dart` file. Dart-Code maps these
 * to `flutter test`, not `flutter run`. */
export function isTestProgram(program: string): boolean {
  return /(?:^|[/\\])test[/\\]?$/.test(program) || /_test\.dart$/.test(program);
}

/** A plain directory program (e.g. "app/") — run the app from that dir with no
 * `-t` (flutter run rejects a directory as a target). */
export function isDirProgram(program: string): boolean {
  return program.endsWith("/") || program.endsWith("\\");
}

/** Single-quote a value so spaces / shell metacharacters in it stay inert when
 * interpolated into a command typed at the shell. */
export function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function fromLaunchConfig(
  c: LaunchConfig,
  i: number,
  root: string,
): Promise<RunTarget | null> {
  if (c.request && c.request !== "launch") return null;
  const type = (c.type ?? "").toLowerCase();
  const isFlutter = type === "dart" || type === "flutter";
  const parts: string[] = [];
  // The dir to run in: explicit `cwd` wins; for Flutter without one, derive it
  // from the program's nearest pubspec.yaml (Dart-Code's rule) so monorepos
  // whose app lives in a subdir don't fail with "No pubspec.yaml file found.".
  let cwd: string | undefined = c.cwd ? resolveCwd(c.cwd, root) : undefined;
  const program = c.program ? expandVars(c.program, root) : undefined;
  const isTest = isFlutter && !!program && isTestProgram(program);

  if (isFlutter) {
    // Derive the run dir from the program's nearest pubspec.yaml (Dart-Code's
    // rule) so monorepos whose app lives in a subdir don't fail with "No
    // pubspec.yaml file found.".
    if (!cwd && program) {
      const dir = await findNearestPubspec(toAbsolute(program, root), root).catch(() => null);
      if (dir) cwd = dir;
    }
    const relProgram = () =>
      cwd && program ? relativePath(cwd, toAbsolute(program, root)) : program;
    if (isTest) {
      // A test config runs `flutter test [<path>]` from the project dir — never
      // `flutter run`, which would silently launch the whole app instead.
      parts.push("flutter test");
      const rel = relProgram();
      if (rel && rel !== ".") parts.push(shquote(rel));
    } else {
      parts.push("flutter run");
      if (c.flutterMode) parts.push(`--${c.flutterMode}`);
      if (program && !isDirProgram(program)) {
        // -t relative to the run dir, matching how VS Code passes it. Skip when
        // the program IS the run dir (e.g. program "app" → rel "."): flutter
        // run rejects a directory target.
        const t = relProgram();
        if (t && t !== ".") parts.push(`-t ${shquote(t)}`);
      }
      if (c.deviceId) parts.push(`-d ${shquote(c.deviceId)}`);
    }
  } else if (program) {
    parts.push(shquote(program));
  } else {
    return null;
  }
  // Each configured arg is one VS Code argument; quote so spaces / shell
  // metacharacters in a single arg don't split into multiple shell words.
  // Args (e.g. --dart-define-from-file=.env) resolve against the run dir.
  if (c.args?.length) parts.push(c.args.map((a) => shquote(expandVars(a, root))).join(" "));
  // Flutter mode gates which live affordances exist: only debug builds run the
  // Dart VM service, so hot reload / inspect / source-map are debug-only.
  // Profile keeps hot restart (no reload, no VM-service inspect); release is a
  // bare launch/stop. (Flutter: release & profile disable debugging + service
  // extensions; release also disables hot reload, profile disables hot reload.)
  const flutterMode = (c.flutterMode ?? "").toLowerCase();
  // Only debug builds run the Dart VM service (absent/empty mode defaults to
  // debug); release and profile disable it.
  const flutterDebug = flutterMode === "" || flutterMode === "debug";
  const flutterCaps =
    flutterMode === "release"
      ? ["launch", "stop"]
      : flutterMode === "profile"
        ? ["launch", "hotRestart", "stop"]
        : ["launch", "hotReload", "hotRestart", "stop", "inspectSelection", "mapSelectionToSource"];
  const capabilities = isTest ? ["test", "stop"] : isFlutter ? flutterCaps : ["launch", "stop"];
  const flutterRun = isFlutter && !isTest;
  return {
    id: `vscode-${i}`,
    label: c.name ?? `Config ${i + 1}`,
    command: parts.join(" "),
    cwd,
    capabilities,
    // A test run executes on the host VM, and a config that already pins a
    // deviceId (e.g. "chrome") needs no picker/auto-boot.
    needsDevice: flutterRun && !c.deviceId,
    // Flutter launch configs inspect via the VM service; everything else is a
    // raw program with no PickForge inspector and no device convention.
    deviceConvention: flutterRun ? "arg" : "none",
    // Only a debug Flutter run can attach the VM service; release/profile runs
    // on a real device but exposes no inspector.
    inspectorKind: flutterRun && flutterDebug ? "vmService" : "none",
    // launch.json configs are Flutter or generic programs — both stream their
    // logs into the run PTY, so no separate Logs tab.
    logSource: "pty",
    source: "vscode",
  };
}

async function readLaunchJson(root: string): Promise<RunTarget[]> {
  try {
    const sep = root.includes("\\") ? "\\" : "/";
    const path = `${root}${sep}.vscode${sep}launch.json`;
    const raw = await invoke<string>("read_text_file", { path, maxBytes: 200_000 });
    const parsed = JSON.parse(stripJsonc(raw));
    const configs: LaunchConfig[] = Array.isArray(parsed?.configurations)
      ? parsed.configurations
      : [];
    const targets = await Promise.all(configs.map((c, i) => fromLaunchConfig(c, i, root)));
    return targets.filter((t): t is RunTarget => t !== null);
  } catch {
    return []; // no .vscode/launch.json (or unreadable) — fine.
  }
}

export async function discoverRunTargets(root: string): Promise<RunTarget[]> {
  const out: RunTarget[] = [];
  try {
    const detected = await targetDetect(root);
    const cmd = defaultCommand(detected);
    if (cmd) {
      const profile = runProfile(detected.targetId);
      out.push({
        id: "detected",
        label: detected.displayName,
        command: cmd,
        capabilities: detected.capabilities,
        needsDevice: profile.needsDevice,
        deviceConvention: profile.deviceConvention,
        inspectorKind: profile.inspectorKind,
        logSource: profile.logSource,
        source: "detected",
      });
    }
  } catch {
    /* not in Tauri / detection failed */
  }
  out.push(...(await readLaunchJson(root)));
  return out;
}

export async function discoverRemoteRunTargets(remote: RemotePty): Promise<RunTarget[]> {
  const pubspecRoot = await remoteNearestPubspec(remote.host, remote.remoteRoot);
  if (!pubspecRoot) {
    throw new Error(`No Flutter project found on ${remote.host} from ${remote.remoteRoot}`);
  }
  const [isFlutterApp, binaries] = await Promise.all([
    remotePubspecUsesFlutter(remote.host, pubspecRoot),
    remoteDetectBinaries(remote.host, ["flutter"]),
  ]);
  if (!isFlutterApp) {
    throw new Error(`Remote project at ${pubspecRoot} is not a Flutter app`);
  }
  if (!binaries[0]) {
    throw new Error(`Flutter is not available on remote host ${remote.host}`);
  }
  const profile = runProfile("flutter");
  return [{
    id: "remote-flutter",
    label: "Flutter · remote",
    command: defaultCommand({ targetId: "flutter" } as TargetDetection)!,
    cwd: pubspecRoot,
    capabilities: [
      "detect", "launch", "stop", "hotReload", "hotRestart", "captureScreenshot",
      "streamLogs", "inspectSelection", "mapSelectionToSource", "exposeMcpTools",
    ],
    needsDevice: false,
    deviceConvention: profile.deviceConvention,
    inspectorKind: profile.inspectorKind,
    logSource: profile.logSource,
    source: "detected",
  }];
}

export function discoverRunTargetsForProject(
  root: string,
  remote: RemotePty | null,
): Promise<RunTarget[]> {
  return remote ? discoverRemoteRunTargets(remote) : discoverRunTargets(root);
}

export interface RunTargetDiscoveryResult {
  targets: RunTarget[];
  error: string | null;
}

export class RunTargetDiscovery {
  private generation = 0;

  cancel(): void {
    this.generation += 1;
  }

  async discover(
    root: string,
    remote: RemotePty | null,
  ): Promise<RunTargetDiscoveryResult | null> {
    const generation = ++this.generation;
    try {
      const targets = await discoverRunTargetsForProject(root, remote);
      return generation === this.generation ? { targets, error: null } : null;
    } catch (error) {
      if (generation !== this.generation) return null;
      return {
        targets: [],
        error: error instanceof Error ? error.message : "Remote run target detection failed",
      };
    }
  }
}
