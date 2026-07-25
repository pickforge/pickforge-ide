// @vitest-environment jsdom
// @vitest-environment-options {"jsdom":{"customExportConditions":["browser"]}}
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ messageQueue: false }));
const platform = vi.hoisted(() => ({ current: "web" as "web" | "macos" }));

vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) => key === "messageQueue" && flags.messageQueue,
}));
vi.mock("../../src/lib/platform", () => ({ hostPlatform: () => platform.current }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("../../src/components/chat/ImageLightbox", () => ({ openLightbox: () => {} }));
vi.mock("../../src/lib/agentChat", () => ({
  agentClipboardFilePaths: vi.fn(async () => []),
  agentClipboardText: vi.fn(async () => ""),
  agentSkillsList: vi.fn(async () => []),
  agentStashClipboardImage: vi.fn(async () => ""),
  agentStashImage: vi.fn(async () => ""),
  agentStashImageFromPath: vi.fn(async () => ""),
  codexConfigDefaultEffort: vi.fn(async () => null),
}));
vi.mock("../../src/lib/agentModels", () => ({
  discoverAgentCli: vi.fn(async () => ({ models: [] })),
  modelOption: vi.fn(() => undefined),
  nativeAgentProfiles: vi.fn(() => []),
  profileWithDiscoveredModels: vi.fn((profile: unknown) => profile),
}));

import { Composer } from "../../src/components/chat/Composer";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  flags.messageQueue = false;
  platform.current = "web";
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.clearAllMocks();
});

function mount(options: {
  supportsSteer?: boolean;
  onQueue?: (text: string, images?: string[]) => void;
  onSteer?: (text: string) => void;
} = {}) {
  const onSend = vi.fn();
  const onQueue = vi.fn(options.onQueue);
  const onSteer = vi.fn(options.onSteer);
  dispose = render(
    () => (
      <Composer
        provider="claudeCode"
        engine="sdk"
        model={null}
        turnActive={true}
        supportsImages={false}
        supportsSteer={options.supportsSteer}
        steerUnavailableReason="Steering unavailable"
        onSend={onSend}
        onQueue={onQueue}
        onSteer={onSteer}
        onInterrupt={() => {}}
      />
    ),
    root,
  );
  const editor = root.querySelector<HTMLElement>(".pf-chat-editor");
  if (!editor) throw new Error("composer did not mount");
  return { editor, onSend, onQueue, onSteer };
}

function type(editor: HTMLElement, value: string): void {
  editor.textContent = value;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

function enter(editor: HTMLElement, options: KeyboardEventInit = {}): void {
  editor.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...options,
  }));
}

describe("Composer message queue keyboard behavior", () => {
  it("queues Enter while a turn is active when the flag is on", () => {
    flags.messageQueue = true;
    const { editor, onQueue, onSend, onSteer } = mount();
    type(editor, "follow up");

    enter(editor);

    expect(onQueue).toHaveBeenCalledWith("follow up", undefined);
    expect(onSend).not.toHaveBeenCalled();
    expect(onSteer).not.toHaveBeenCalled();
    expect(editor.textContent).toBe("");
    expect(editor.getAttribute("aria-label")).toBe("Queue the next message…");
  });

  it("does not enqueue Enter with the flag off and preserves existing steering", () => {
    const { editor, onQueue, onSteer } = mount({ supportsSteer: true });
    type(editor, "redirect now");

    enter(editor);

    expect(onQueue).not.toHaveBeenCalled();
    expect(onSteer).toHaveBeenCalledWith("redirect now");
    expect(editor.getAttribute("aria-label")).toBe("Steer the running turn…");
    expect(editor.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it.each([
    ["macos", { metaKey: true }, "Meta+Enter", "⌘⏎"],
    ["web", { ctrlKey: true }, "Control+Enter", "Ctrl⏎"],
  ] as const)(
    "%s steer chord steers instead of queueing when supported",
    (host, shortcut, ariaShortcut, visibleShortcut) => {
      flags.messageQueue = true;
      platform.current = host;
      const { editor, onQueue, onSteer } = mount({ supportsSteer: true });
      type(editor, "change course");

      enter(editor, shortcut);

      expect(onSteer).toHaveBeenCalledWith("change course");
      expect(onQueue).not.toHaveBeenCalled();
      expect(editor.getAttribute("aria-keyshortcuts")).toBe(ariaShortcut);
      expect(editor.getAttribute("aria-label")).toContain(`${visibleShortcut} steers…`);
    },
  );

  it("leaves the steer chord inert when the backend does not support steering", () => {
    flags.messageQueue = true;
    const { editor, onQueue, onSteer } = mount({ supportsSteer: false });
    type(editor, "do not dispatch");

    enter(editor, { ctrlKey: true });

    expect(onSteer).not.toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
    expect(editor.textContent).toBe("do not dispatch");
    expect(editor.title).toBe("Steering unavailable");
    expect(editor.getAttribute("aria-description")).toBe("Steering unavailable");
    expect(editor.hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});
