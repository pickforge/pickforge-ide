import { describe, expect, it } from "vitest";

// notifications.ts pulls in the workspace store (Tauri db + SolidJS store). We
// only test the PURE should-notify gate, so stub the store with an in-memory
// activeChatId — no runtime needed. The plugin import is dynamic + lazy, so it
// never loads under this test.
import { vi } from "vitest";
const store = vi.hoisted(() => ({ workspace: { activeChatId: null as string | null } }));
vi.mock("../../src/stores/workspace", () => store);
// router.ts reads window.location.hash at module load — stub it so the pure
// shouldNotify gate (which now imports the route signal) needs no DOM.
vi.mock("../../src/router", () => ({ route: () => "workbench" }));

import { shouldNotify, type NotifyContext } from "../../src/stores/notifications";

describe("shouldNotify", () => {
  const base: NotifyContext = {
    enabled: true,
    windowFocused: true,
    activeChatId: "chat-1",
    workbenchVisible: true,
  };

  it("does not notify when notifications are disabled", () => {
    expect(shouldNotify("chat-2", { ...base, enabled: false })).toBe(false);
  });

  it("does not notify for the chat the user is viewing with the window focused", () => {
    expect(shouldNotify("chat-1", { ...base, windowFocused: true, activeChatId: "chat-1" })).toBe(
      false,
    );
  });

  it("notifies for a non-active chat even when the window is focused", () => {
    expect(shouldNotify("chat-2", { ...base, windowFocused: true, activeChatId: "chat-1" })).toBe(
      true,
    );
  });

  it("notifies for the active chat when the window is unfocused", () => {
    expect(shouldNotify("chat-1", { ...base, windowFocused: false, activeChatId: "chat-1" })).toBe(
      true,
    );
  });

  it("notifies when no chat is active (window unfocused or other route)", () => {
    expect(shouldNotify("chat-1", { ...base, windowFocused: false, activeChatId: null })).toBe(true);
  });

  it("notifies for the focused active chat when the Workbench is NOT visible", () => {
    // User is focused on Settings/History; the Workbench (and its chats) is
    // mounted-but-hidden, so the active chat is not actually on screen.
    expect(
      shouldNotify("chat-1", {
        ...base,
        windowFocused: true,
        activeChatId: "chat-1",
        workbenchVisible: false,
      }),
    ).toBe(true);
  });

  it("does not notify only when the chat is genuinely visible (workbench + focus + active)", () => {
    expect(
      shouldNotify("chat-1", {
        ...base,
        windowFocused: true,
        activeChatId: "chat-1",
        workbenchVisible: true,
      }),
    ).toBe(false);
  });
});
