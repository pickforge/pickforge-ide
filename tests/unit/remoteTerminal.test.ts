import { describe, expect, it, vi } from "vitest";
import { deliverPtyExit, startPtyWithLocalFallback } from "../../src/lib/remoteTerminal";

const remote = { host: "mac-mini", remoteRoot: "/srv/app" };

describe("startPtyWithLocalFallback", () => {
  it("retries a failed remote start locally", async () => {
    const start = vi.fn(async (context: typeof remote | null) => {
      if (context) throw new Error("remote unavailable");
      return 42;
    });
    const onFallback = vi.fn();

    await expect(startPtyWithLocalFallback(remote, start, onFallback)).resolves.toBe(42);

    expect(start).toHaveBeenNthCalledWith(1, remote);
    expect(start).toHaveBeenNthCalledWith(2, null);
    expect(onFallback).toHaveBeenCalledExactlyOnceWith(remote);
  });
});

describe("deliverPtyExit", () => {
  it("warns and still closes an established remote session that exits 255", () => {
    const onNotice = vi.fn();
    const onExit = vi.fn();

    deliverPtyExit(remote, 255, onNotice, onExit);

    expect(onNotice).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledExactlyOnceWith(255);
  });
});
