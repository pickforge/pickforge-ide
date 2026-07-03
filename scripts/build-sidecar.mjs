// Build the `pickforge-mcp` stdio adapter and stage it as a Tauri sidecar.
//
// Tauri bundles "external binaries" listed under `bundle.externalBin`, resolving
// each by appending the *target triple* to the configured name (e.g.
// `binaries/pickforge-mcp` -> `binaries/pickforge-mcp-x86_64-unknown-linux-gnu`).
// Cargo emits the binary as plain `pickforge-mcp` under `target/<profile>/`, so
// this script compiles it and copies it to the triple-suffixed path the bundler
// expects. Run from `beforeBuildCommand` so a packaged app actually ships the
// adapter (without this, MCP discovery finds nothing in a release build).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The host target triple, parsed from `rustc -vV` (Tauri's own convention). */
function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("could not determine host target triple from `rustc -vV`");
  return line.replace("host:", "").trim();
}

const host = hostTriple();
const requestedTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET;
const triple = requestedTriple || host;
const cargoTarget = requestedTriple ? triple : null;
// Release by default; `--debug` mirrors `tauri build --debug` so the staged
// binary matches the bundle's profile.
const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";

const cargoArgs = ["build", "-p", "pickforge-mcp"];
if (!debug) cargoArgs.push("--release");
if (cargoTarget) cargoArgs.push("--target", cargoTarget);

console.log(`[sidecar] cargo ${cargoArgs.join(" ")}`);
execFileSync("cargo", cargoArgs, { cwd: root, stdio: "inherit" });

const ext = process.platform === "win32" ? ".exe" : "";
const built = cargoTarget
  ? join(root, "target", cargoTarget, profile, `pickforge-mcp${ext}`)
  : join(root, "target", profile, `pickforge-mcp${ext}`);
const destDir = join(root, "src-tauri", "binaries");
const dest = join(destDir, `pickforge-mcp-${triple}${ext}`);

mkdirSync(destDir, { recursive: true });
copyFileSync(built, dest);
console.log(`[sidecar] staged ${dest}`);

// The Claude bridge runs on the Agent SDK — a packaged app has neither Bun nor
// the repo's node_modules, so compile it into a self-contained executable and
// ship it the same way. Dev keeps spawning `bun scripts/claude-bridge.ts`.
// Bun cross-compilation uses bun-specific targets, not Rust triples, so this
// only fixes the staged suffix for requested Tauri/Cargo targets.
const bridgeDest = join(destDir, `pickforge-claude-bridge-${triple}${ext}`);
console.log("[sidecar] bun build --compile scripts/claude-bridge.ts");
execFileSync(
  "bun",
  ["build", "--compile", join(root, "scripts", "claude-bridge.ts"), "--outfile", bridgeDest],
  { cwd: root, stdio: "inherit" },
);
console.log(`[sidecar] staged ${bridgeDest}`);
