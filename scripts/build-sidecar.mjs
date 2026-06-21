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

const triple = hostTriple();
// Release by default; `--debug` mirrors `tauri build --debug` so the staged
// binary matches the bundle's profile.
const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";

const cargoArgs = ["build", "-p", "pickforge-mcp"];
if (!debug) cargoArgs.push("--release");

console.log(`[sidecar] cargo ${cargoArgs.join(" ")}`);
execFileSync("cargo", cargoArgs, { cwd: root, stdio: "inherit" });

const ext = process.platform === "win32" ? ".exe" : "";
const built = join(root, "target", profile, `pickforge-mcp${ext}`);
const destDir = join(root, "src-tauri", "binaries");
const dest = join(destDir, `pickforge-mcp-${triple}${ext}`);

mkdirSync(destDir, { recursive: true });
copyFileSync(built, dest);
console.log(`[sidecar] staged ${dest}`);
