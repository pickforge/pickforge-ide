// Run-target discovery: the detected project target (Flutter / React Native /
// Android / Web) plus any `.vscode/launch.json` configurations. Targets are run
// by typing a command into the focused terminal (PTY); hot reload / restart /
// stop are keystrokes the running tool reads from stdin — so no new runner.
import { invoke } from "@tauri-apps/api/core";
import { targetDetect, type TargetDetection } from "./device";

export interface RunTarget {
  id: string;
  label: string;
  /** command typed at the prompt (without a trailing newline) */
  command: string;
  /** capability strings: "hotReload" | "hotRestart" | "stop" | "launch" … */
  capabilities: string[];
  /** flutter/android targets accept a device serial */
  needsDevice: boolean;
  source: "detected" | "vscode";
}

// Target ids match crates/pickforge-core/src/targets/adapters.rs.
function defaultCommand(t: TargetDetection): string | null {
  switch (t.targetId) {
    case "flutter":
      return "flutter run";
    case "react-native":
      return "npx react-native run-android";
    case "native-android":
      return "./gradlew installDebug";
    case "web":
      return "npm run dev";
    default:
      return null;
  }
}

const DEVICE_TARGETS = new Set(["flutter", "react-native", "native-android"]);

/** Strip // and /* *​/ comments so JSONC (launch.json) parses as JSON. */
function stripJsonc(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
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

/** Resolve a launch config `cwd` to an absolute path, the way VS Code does:
 * relative values are joined onto the workspace folder (the project root). */
function resolveCwd(cwd: string, root: string): string {
  const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(cwd);
  if (isAbs) return cwd;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[/\\]+$/, "")}${sep}${cwd.replace(/^[/\\]+/, "")}`;
}

/** Single-quote a value so spaces / shell metacharacters in it stay inert when
 * interpolated into a command typed at the shell. */
export function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function fromLaunchConfig(c: LaunchConfig, i: number, root: string): RunTarget | null {
  if (c.request && c.request !== "launch") return null;
  const type = (c.type ?? "").toLowerCase();
  const isFlutter = type === "dart" || type === "flutter";
  const parts: string[] = [];
  if (isFlutter) {
    parts.push("flutter run");
    if (c.flutterMode) parts.push(`--${c.flutterMode}`);
    if (c.program) parts.push(`-t ${shquote(c.program)}`);
    if (c.deviceId) parts.push(`-d ${shquote(c.deviceId)}`);
  } else if (c.program) {
    parts.push(shquote(c.program));
  } else {
    return null;
  }
  if (c.args?.length) parts.push(c.args.join(" "));
  let command = parts.join(" ");
  // VS Code launches the program from `cwd`; the embedded terminal sits at the
  // project root, so `cd` into the resolved (absolute) dir first — otherwise
  // `flutter run` runs where there is no pubspec.yaml. Absolute so repeated
  // runs work no matter where the shell currently is.
  if (c.cwd) command = `cd ${shquote(resolveCwd(c.cwd, root))} && ${command}`;
  return {
    id: `vscode-${i}`,
    label: c.name ?? `Config ${i + 1}`,
    command,
    capabilities: isFlutter
      ? ["launch", "hotReload", "hotRestart", "stop"]
      : ["launch", "stop"],
    needsDevice: isFlutter,
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
    return configs
      .map((c, i) => fromLaunchConfig(c, i, root))
      .filter((t): t is RunTarget => t !== null);
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
      out.push({
        id: "detected",
        label: detected.displayName,
        command: cmd,
        capabilities: detected.capabilities,
        needsDevice: DEVICE_TARGETS.has(detected.targetId),
        source: "detected",
      });
    }
  } catch {
    /* not in Tauri / detection failed */
  }
  out.push(...(await readLaunchJson(root)));
  return out;
}
