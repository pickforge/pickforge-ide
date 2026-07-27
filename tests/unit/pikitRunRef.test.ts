import { describe, expect, it } from "vitest";
import { pikitRowIsLive, pikitRunRef } from "../../src/lib/pikitRunRef";

const row = (over: Partial<Parameters<typeof pikitRunRef>[0]> = {}) => ({
  server: "pickforge-lanes",
  tool: "lanes_wait",
  detail: "run: run-20260726T101112-4821",
  status: "inProgress" as const,
  ...over,
});

describe("pikitRunRef — correlating an MCP row to its pi-kit run (#362)", () => {
  it("reads the run from a lanes_wait argument summary", () => {
    expect(pikitRunRef(row())).toBe("run-20260726T101112-4821");
  });

  it("reads the run out of a lanes_spawn result once it lands", () => {
    // A spawn names no run going in; the id only exists in the result.
    expect(
      pikitRunRef(row({ tool: "lanes_spawn", detail: "started run-20260726T101112-4821 with 3 lanes" })),
    ).toBe("run-20260726T101112-4821");
  });

  it("resolves to nothing for an in-flight spawn that has not named a run", () => {
    expect(pikitRunRef(row({ tool: "lanes_spawn", detail: "lanes: 3, model: sol" }))).toBeNull();
  });

  it("ignores rows from any other MCP server", () => {
    expect(pikitRunRef(row({ server: "github" }))).toBeNull();
  });

  it("ignores a row with no detail at all", () => {
    expect(pikitRunRef(row({ detail: null }))).toBeNull();
    expect(pikitRunRef(row({ detail: "   " }))).toBeNull();
  });

  it("does not mistake an ordinary word for a run id", () => {
    expect(pikitRunRef(row({ detail: "waiting for the run to finish" }))).toBeNull();
  });
});

describe("pikitRowIsLive — live in flight, frozen after (#362)", () => {
  it("polls while the call is in flight", () => {
    expect(pikitRowIsLive(row({ status: "inProgress" }))).toBe(true);
  });

  it("freezes once the call has completed or failed", () => {
    // A replayed row must not rewrite itself from a run that has moved on.
    expect(pikitRowIsLive(row({ status: "completed" }))).toBe(false);
    expect(pikitRowIsLive(row({ status: "failed" }))).toBe(false);
  });

  it("never polls a row with no run to poll for", () => {
    expect(pikitRowIsLive(row({ detail: null }))).toBe(false);
    expect(pikitRowIsLive(row({ server: "github" }))).toBe(false);
  });

  it("does not poll a row whose status is unknown (pre-flag history)", () => {
    expect(pikitRowIsLive(row({ status: undefined }))).toBe(false);
  });
});
