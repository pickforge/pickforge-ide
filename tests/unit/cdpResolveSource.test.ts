import { afterEach, describe, expect, it, vi } from "vitest";

// cdpResolveSource calls the cdp_fetch_source_map / cdp_map_source Tauri
// commands; stub invoke so no runtime is needed. The forge must apply the source
// map BEFORE recording so the audit row carries the authored file:line, not the
// generated build artifact.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { cdpResolveSource } from "../../src/lib/cdp";

afterEach(() => {
  invoke.mockReset();
});

describe("cdpResolveSource", () => {
  it("maps a generated file:line:col to the authored position via the source map", async () => {
    invoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "cdp_fetch_source_map") {
        expect(args.mapPath).toBe("/assets/index-abc.js.map");
        return Promise.resolve("{json}");
      }
      if (cmd === "cdp_map_source") {
        // Attribute is 1-based (12:5); the decoder gets 0-based (11:4).
        expect(args).toMatchObject({ mapJson: "{json}", line: 11, column: 4 });
        return Promise.resolve({ source: "src/App.tsx", line: 2, column: 0, name: null });
      }
      return Promise.resolve(null);
    });
    // Authored line is re-based to 1-based for recording parity (2 -> 3).
    const out = await cdpResolveSource("127.0.0.1", 9222, "/assets/index-abc.js:12:5");
    expect(out).toBe("src/App.tsx:3");
  });

  it("falls back (null) when the generated position is unmapped", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "cdp_fetch_source_map") return Promise.resolve("{json}");
      if (cmd === "cdp_map_source") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    expect(await cdpResolveSource("127.0.0.1", 9222, "/assets/index.js:1:1")).toBeNull();
  });

  it("falls back (null) when the .map fetch fails, and never throws", async () => {
    invoke.mockRejectedValue(new Error("404"));
    await expect(
      cdpResolveSource("127.0.0.1", 9222, "/assets/index.js:1:1"),
    ).resolves.toBeNull();
  });

  it("skips paths that aren't a fetchable script artifact (no source map to apply)", async () => {
    // A non-script source label (e.g. Vue's .vue path a plugin already resolved)
    // or a bare string has no sibling .map — don't even attempt a fetch.
    expect(await cdpResolveSource("127.0.0.1", 9222, "src/App.vue:3:1")).toBeNull();
    expect(await cdpResolveSource("127.0.0.1", 9222, "not-a-position")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
