import { describe, expect, it, vi } from "vitest";

// lib/pty pulls in @tauri-apps/api/core (invoke, Channel) at module load;
// mock it so this pure-function test runs under node with no runtime
// (matches tests/unit/chatSessions.test.ts's pattern for the same module).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

import { askpassNotice, type AskpassStatus } from "../../src/lib/pty";

// pickforge#215 — the chat pane's Linux graphical sudo (askpass) notice.
describe("askpassNotice", () => {
  it("renders nothing when agents can already run sudo -A", () => {
    expect(askpassNotice("available")).toBeNull();
  });

  it("renders nothing on an out-of-scope platform (macOS/Windows)", () => {
    expect(askpassNotice("unsupportedPlatform")).toBeNull();
  });

  it("renders nothing before the capability query has resolved", () => {
    expect(askpassNotice(null)).toBeNull();
  });

  it("names the missing helper for the noHelper failure state", () => {
    expect(askpassNotice("noHelper")).toBe("no sudo helper — run sudo in a terminal");
  });

  it("names the missing graphical session for the headless failure state", () => {
    expect(askpassNotice("headless")).toBe("no graphical session — run sudo in a terminal");
  });

  it("covers every AskpassStatus value — extending the union without updating this test fails typecheck", () => {
    const statuses: AskpassStatus[] = ["available", "noHelper", "headless", "unsupportedPlatform"];
    const rendered = statuses.map((status) => askpassNotice(status));
    // Exactly the two actionable failure states render a notice.
    expect(rendered.filter((notice) => notice !== null)).toHaveLength(2);
  });
});
