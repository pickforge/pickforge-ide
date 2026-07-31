// The Tauri v2 platform-config merge (RFC 7396) replaces the `windows` array
// wholesale, so tauri.macos.conf.json must restate the full main-window entry.
// This guards against drift: a field edited in the base config but forgotten in
// the macOS overlay would silently not apply on macOS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MACOS_ONLY_FIELDS = ["decorations", "titleBarStyle", "hiddenTitle", "trafficLightPosition"];

function mainWindow(path: string): Record<string, unknown> {
  const conf = JSON.parse(readFileSync(path, "utf8")) as {
    app: { windows: Array<Record<string, unknown>> };
  };
  const win = conf.app.windows.find((w) => w.label === "main");
  if (!win) throw new Error(`no main window in ${path}`);
  return win;
}

describe("tauri.macos.conf.json window entry", () => {
  it("matches the base window entry apart from the macOS chrome fields", () => {
    const base = mainWindow("src-tauri/tauri.conf.json");
    const macos = mainWindow("src-tauri/tauri.macos.conf.json");

    const strip = (win: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(win).filter(([k]) => !MACOS_ONLY_FIELDS.includes(k)));

    expect(strip(macos)).toEqual(strip(base));
    expect(macos.decorations).toBe(true);
    expect(macos.titleBarStyle).toBe("Overlay");
    expect(macos.hiddenTitle).toBe(true);
  });
});
