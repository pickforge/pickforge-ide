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

/** Convert JSONC (launch.json) to JSON: strip // and /* *​/ comments and
 *  trailing commas, which VS Code accepts. String-aware so commas/slashes
 *  inside quoted values (e.g. URLs, "a,]") are left untouched. */
function stripJsonc(src: string): string {
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

/** Resolve a launch config `cwd` to an absolute path, the way VS Code does:
 * expand the workspace-folder variables, then join relative values onto the
 * workspace folder (the project root). */
function resolveCwd(cwd: string, root: string): string {
  const base = root.replace(/[/\\]+$/, "");
  const baseName = base.split(/[/\\]/).pop() ?? "";
  // Expand basename first — it shares the ${workspaceFolder} prefix.
  const expanded = cwd
    .replace(/\$\{workspaceFolderBasename\}/g, baseName)
    .replace(/\$\{workspaceFolder\}/g, base);
  const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(expanded);
  if (isAbs) return expanded;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${base}${sep}${expanded.replace(/^[/\\]+/, "")}`;
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
  // Each configured arg is one VS Code argument; quote so spaces / shell
  // metacharacters in a single arg don't split into multiple shell words.
  if (c.args?.length) parts.push(c.args.map(shquote).join(" "));
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
