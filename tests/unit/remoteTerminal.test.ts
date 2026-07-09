import { describe, expect, it, vi } from "vitest";
import { remotePtyExit, startPtyWithLocalFallback } from "../../src/lib/remoteTerminal";

const remote = { host: "mac-mini", remoteRoot: "/srv/app" };

describe("startPtyWithLocalFallback", () => {
  it("retries a failed remote start locally", async () => {
    const start = vi.fn(async (context: typeof remote | null) => {
      if (context) throw new Error("remote unavailable");
      return 42;
    });
    const onFallback = vi.fn();

    await expect(startPtyWithLocalFallback(remote, start, onFallback)).resolves.toEqual({
      remote: null,
      value: 42,
    });

    expect(start).toHaveBeenNthCalledWith(1, remote);
    expect(start).toHaveBeenNthCalledWith(2, null);
    expect(onFallback).toHaveBeenCalledExactlyOnceWith(remote);
  });
});

describe("remotePtyExit", () => {
  it("warns and still closes an established remote session that exits 255", () => {
    const exit = remotePtyExit(remote, 255);

    expect(exit.notice).toContain("ssh:mac-mini");
    expect(exit.preserveBuffer).toBe(true);
  });
});
