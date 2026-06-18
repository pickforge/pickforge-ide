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

function defaultCommand(t: TargetDetection): string | null {
  switch (t.targetId) {
    case "flutter":
      return "flutter run";
    case "reactNativeAndroid":
      return "npx react-native run-android";
    case "nativeAndroid":
      return "./gradlew installDebug";
    case "web":
      return "npm run dev";
    default:
      return null;
  }
}

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
}

function fromLaunchConfig(c: LaunchConfig, i: number): RunTarget | null {
  if (c.request && c.request !== "launch") return null;
  const type = (c.type ?? "").toLowerCase();
  const isFlutter = type === "dart" || type === "flutter";
  const parts: string[] = [];
  if (isFlutter) {
    parts.push("flutter run");
    if (c.flutterMode) parts.push(`--${c.flutterMode}`);
    if (c.program) parts.push(`-t ${c.program}`);
    if (c.deviceId) parts.push(`-d ${c.deviceId}`);
  } else if (c.program) {
    parts.push(c.program);
  } else {
    return null;
  }
  if (c.args?.length) parts.push(c.args.join(" "));
  return {
    id: `vscode-${i}`,
    label: c.name ?? `Config ${i + 1}`,
    command: parts.join(" "),
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
    return configs.map(fromLaunchConfig).filter((t): t is RunTarget => t !== null);
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
        needsDevice: detected.targetId === "flutter" || detected.targetId.toLowerCase().includes("android"),
        source: "detected",
      });
    }
  } catch {
    /* not in Tauri / detection failed */
  }
  out.push(...(await readLaunchJson(root)));
  return out;
}
