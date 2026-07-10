import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { remoteTunnelClose } from "../../src/lib/remoteHost";

describe("remote tunnel close", () => {
  it("closes by app-instance tunnel id after the project binding is detached", async () => {
    invokeMock.mockResolvedValue(undefined);

    await remoteTunnelClose("remote-tunnel-7");

    expect(invokeMock).toHaveBeenCalledWith("remote_tunnel_close", {
      tunnelId: "remote-tunnel-7",
    });
  });
});
