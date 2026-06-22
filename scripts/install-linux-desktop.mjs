#!/usr/bin/env node
// Install a CORRECT XDG desktop entry + hicolor icons for the Tauri build so the
// running window (Wayland/X11) shows the PickForge mark instead of a generic icon.
//
// Why this is needed: Tauri sets the GTK/Wayland app_id to the bundle identifier
// ("dev.pickforge.app") only because tauri.conf.json now has `app.enableGTKAppId:
// true`. A compositor maps that app_id to an installed `.desktop` whose basename
// matches, and pulls the icon named by its `Icon=` key from the hicolor theme.
// The repo previously only had a stale Flutter-era `pickforge.desktop`
// (Icon=pickforge, StartupWMClass=pickforge, Exec=build/linux/...), which never
// matches the Tauri app_id — hence the generic icon.
//
// This installs (user scope, ~/.local/share):
//   - applications/dev.pickforge.app.desktop  (Icon + StartupWMClass = app_id)
//   - icons/hicolor/{32x32,128x128,256x256,512x512}/apps/dev.pickforge.app.png
// then refreshes the desktop + icon caches. It also offers to back up & remove the
// stale pickforge.desktop (never deletes silently).
//
// Usage:
//   node scripts/install-linux-desktop.mjs            # dev binary (target/debug)
//   node scripts/install-linux-desktop.mjs --release  # release binary
//   node scripts/install-linux-desktop.mjs --exec /abs/path/to/pickforge-tauri
//   node scripts/install-linux-desktop.mjs --remove-stale   # also drop pickforge.desktop
//
// Release packages (.deb/.rpm/.AppImage) ship their own generated entry + icon
// keyed on the identifier, so this script is for dev / bare-binary runs.

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const APP_ID = "dev.pickforge.app";
const APP_NAME = "PickForge";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const iconSrcDir = join(repoRoot, "src-tauri", "icons");

if (platform() !== "linux") {
  console.error("This installer is Linux-only (the icon/app_id issue is Wayland/X11 specific).");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const home = homedir();
const dataHome = process.env.XDG_DATA_HOME || join(home, ".local", "share");
const appsDir = join(dataHome, "applications");
const hicolorDir = join(dataHome, "icons", "hicolor");

// Resolve the binary the entry should launch.
function resolveExec() {
  const explicit = valueOf("--exec");
  if (explicit) return resolve(explicit);
  const variant = flag("--release") ? "release" : "debug";
  return join(repoRoot, "target", variant, "pickforge-tauri");
}
const execPath = resolveExec();
if (!existsSync(execPath)) {
  console.error(`Binary not found: ${execPath}`);
  console.error("Build it first (e.g. `bun run tauri build` or `bun run tauri dev`), or pass --exec /abs/path.");
  process.exit(1);
}

// hicolor size -> source icon. The bundled icons already match these sizes
// exactly, so we copy; if a size is somehow missing we resize from icon.png.
const ICON_MAP = [
  { size: "32x32", src: "32x32.png" },
  { size: "128x128", src: "128x128.png" },
  { size: "256x256", src: "128x128@2x.png" },
  { size: "512x512", src: "icon.png" },
];

function have(cmd) {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function installIcons() {
  const resizer = have("magick") ? "magick" : have("convert") ? "convert" : null;
  for (const { size, src } of ICON_MAP) {
    const destDir = join(hicolorDir, size, "apps");
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, `${APP_ID}.png`);
    const srcPath = join(iconSrcDir, src);
    if (existsSync(srcPath)) {
      copyFileSync(srcPath, dest);
    } else if (resizer) {
      const px = size.split("x")[0];
      execFileSync(resizer, [join(iconSrcDir, "icon.png"), "-resize", `${px}x${px}`, dest]);
    } else {
      console.warn(`! Skipped ${size}: ${src} missing and no ImageMagick to resize.`);
      continue;
    }
    console.log(`  icon  ${size.padEnd(8)} -> ${dest}`);
  }
}

// Quote a program path for an Exec= value per the Desktop Entry spec: wrap in
// double quotes and backslash-escape the reserved chars (`"` `` ` `` `$` `\`) so
// a checkout/--exec path containing spaces or reserved characters stays a single
// argument instead of being split or mis-launched.
function quoteExec(path) {
  const escaped = path.replace(/(["`$\\])/g, "\\$1");
  return `"${escaped}"`;
}

function installDesktop() {
  mkdirSync(appsDir, { recursive: true });
  const dest = join(appsDir, `${APP_ID}.desktop`);
  // StartupWMClass MUST equal the Wayland/X11 app_id (the bundle identifier, set
  // via enableGTKAppId). Icon is the hicolor icon name (no extension/path).
  const entry = `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Shell-first workbench that drives Claude, Codex, and your build tools
Exec=${quoteExec(execPath)}
Icon=${APP_ID}
Terminal=false
Categories=Development;IDE;Utility;
StartupWMClass=${APP_ID}
StartupNotify=true
`;
  writeFileSync(dest, entry, "utf8");
  console.log(`  entry          -> ${dest}`);
  return dest;
}

function handleStale() {
  const stale = join(appsDir, "pickforge.desktop");
  if (!existsSync(stale)) return;
  // Only act on the known Flutter-era leftover (Icon=pickforge / StartupWMClass=pickforge).
  let isFlutterEra = false;
  try {
    const body = readFileSync(stale, "utf8");
    isFlutterEra = /StartupWMClass=pickforge\b/.test(body) || /Icon=pickforge\b/.test(body);
  } catch {
    /* unreadable — leave it alone */
  }
  if (!isFlutterEra) {
    console.log(`  note: ${stale} exists but doesn't look like the stale Flutter entry — leaving it.`);
    return;
  }
  if (!flag("--remove-stale")) {
    console.log(`\n  Stale Flutter entry found: ${stale}`);
    console.log("  Re-run with --remove-stale to back it up (.bak) and remove it.");
    return;
  }
  const backup = `${stale}.bak`;
  copyFileSync(stale, backup);
  renameSync(stale, `${stale}.removed`); // keep the original bytes too, just out of the way
  console.log(`  removed stale  -> backed up to ${backup} (and ${stale}.removed)`);
}

function refreshCaches() {
  if (have("update-desktop-database")) {
    try {
      execFileSync("update-desktop-database", [appsDir], { stdio: "ignore" });
      console.log("  refreshed desktop database");
    } catch { /* non-fatal */ }
  }
  if (have("gtk-update-icon-cache")) {
    try {
      // -f force, -t tolerate a theme dir without an index.theme
      execFileSync("gtk-update-icon-cache", ["-f", "-t", hicolorDir], { stdio: "ignore" });
      console.log("  refreshed hicolor icon cache");
    } catch { /* non-fatal: many distros rebuild lazily */ }
  }
}

console.log(`Installing ${APP_NAME} desktop integration (app_id: ${APP_ID})`);
console.log(`  exec: ${execPath}`);
installIcons();
installDesktop();
handleStale();
refreshCaches();
console.log(
  "\nDone. If the running window still shows a generic icon, fully quit and relaunch it" +
    " (compositors cache the app_id->icon mapping per window)."
);
