// Run-target discovery: the detected project target (Flutter / React Native /
// Android / Web) plus any `.vscode/launch.json` configurations. Targets are run
// by typing a command into the focused terminal (PTY); hot reload / restart /
// stop are keystrokes the running tool reads from stdin — so no new runner.
import { invoke } from "@tauri-apps/api/core";
import { findNearestPubspec, targetDetect, type TargetDetection } from "./device";

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

/** Expand VS Code's workspace-folder variables (basename first — it shares the
 * ${workspaceFolder} prefix). */
function expandVars(value: string, root: string): string {
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
function isTestProgram(program: string): boolean {
  return /(?:^|[/\\])test[/\\]?$/.test(program) || /_test\.dart$/.test(program);
}

/** A plain directory program (e.g. "app/") — run the app from that dir with no
 * `-t` (flutter run rejects a directory as a target). */
function isDirProgram(program: string): boolean {
  return program.endsWith("/") || program.endsWith("\\");
}

/** Single-quote a value so spaces / shell metacharacters in it stay inert when
 * interpolated into a command typed at the shell. */
export function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function fromLaunchConfig(
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
  const capabilities = isTest
    ? ["test", "stop"]
    : isFlutter
      ? ["launch", "hotReload", "hotRestart", "stop"]
      : ["launch", "stop"];
  return {
    id: `vscode-${i}`,
    label: c.name ?? `Config ${i + 1}`,
    command: parts.join(" "),
    cwd,
    capabilities,
    // A test run executes on the host VM, and a config that already pins a
    // deviceId (e.g. "chrome") needs no picker/auto-boot.
    needsDevice: isFlutter && !isTest && !c.deviceId,
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
