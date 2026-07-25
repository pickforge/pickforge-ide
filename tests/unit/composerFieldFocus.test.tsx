// @vitest-environment jsdom
//
// Regression coverage for #342. The composer's frame (border/radius/background)
// moved from the contenteditable editor onto a `.pf-chat-field` wrapper so the
// context/cost meter can sit inside the input as a bottom gutter. That makes the
// visible "input" larger than its editable area for the first time: clicks on
// the gutter, the readout, or the frame padding land on a non-focusable wrapper.
//
// Without the wrapper's mousedown routing, two things break — clicking the lower
// strip of a text field does nothing (it looks broken), and a click on the
// readout *blurs* a focused editor, which also silently defeats the
// `document.activeElement === field` guards that anchor paste/drop insertion at
// the caret (Composer.tsx: insertionRange, pinMarkerAnchor, addPendingImage).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../src/components/chat/ImageLightbox", () => ({ openLightbox: () => {} }));

// The composer discovers CLIs and skills on mount and reads clipboard/stash IPC
// on paste. None of that is under test here, and importing the real modules
// pulls in the workspace stores (localStorage at import time), so both seams are
// stubbed outright rather than spread over the originals.
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
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.clearAllMocks();
});

function mount(meter?: () => import("solid-js").JSX.Element) {
  dispose = render(
    () => (
      <Composer
        provider="claudeCode"
        engine="sdk"
        model={null}
        turnActive={false}
        supportsImages={false}
        onSend={() => {}}
        onInterrupt={() => {}}
        meter={meter?.()}
      />
    ),
    root,
  );
  const field = root.querySelector<HTMLElement>(".pf-chat-field");
  const editor = root.querySelector<HTMLElement>(".pf-chat-editor");
  if (!field || !editor) throw new Error("composer did not mount");
  return { field, editor };
}

function mousedown(target: HTMLElement): MouseEvent {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("composer field frame", () => {
  it("routes a click on the frame itself into the editor", () => {
    const { field, editor } = mount();
    expect(document.activeElement).not.toBe(editor);

    const event = mousedown(field);

    expect(document.activeElement).toBe(editor);
    // The browser's own (useless) caret placement on a non-editable target is
    // suppressed; the component places the caret instead.
    expect(event.defaultPrevented).toBe(true);
  });

  // jsdom does not implement the browser's focus-steal on mousedown, so this
  // cannot reproduce the native blur itself; it pins the handler's own outcome —
  // a readout click must leave focus on the editor, never move it elsewhere.
  it("keeps the editor focused when the meter readout is clicked", () => {
    const { editor } = mount(() => (
      <div class="pf-chat-context">
        <span class="pf-chat-context-frac">27k / 1M</span>
      </div>
    ));
    editor.focus();
    expect(document.activeElement).toBe(editor);

    const frac = root.querySelector<HTMLElement>(".pf-chat-context-frac");
    expect(frac).not.toBeNull();
    mousedown(frac!);

    expect(document.activeElement).toBe(editor);
  });

  it("leaves clicks inside the editor to the browser", () => {
    const { editor } = mount();

    const event = mousedown(editor);

    // Native caret placement must survive — the handler only covers the frame.
    expect(event.defaultPrevented).toBe(false);
  });
});
