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
import { caretOffset, setCaretAtOffset } from "../../src/lib/composerChips";

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

function mousedown(target: HTMLElement, button = 0): MouseEvent {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
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

  // jsdom does not implement the browser's focus-steal on mousedown, so the
  // native blur cannot be reproduced here. What is asserted is the mechanism
  // that prevents it — the suppressed default — plus the outcome: focus stays on
  // the editor and the caret is left alone rather than collapsed to the end.
  it("suppresses the default on a readout click so a focused editor keeps its caret", () => {
    const { editor } = mount(() => (
      <div class="pf-chat-context">
        <span class="pf-chat-context-frac">27k / 1M</span>
      </div>
    ));
    editor.focus();
    expect(document.activeElement).toBe(editor);

    const frac = root.querySelector<HTMLElement>(".pf-chat-context-frac");
    expect(frac).not.toBeNull();
    const event = mousedown(frac!);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor);
  });

  it("leaves clicks inside the editor to the browser", () => {
    const { editor } = mount();

    const event = mousedown(editor);

    // Native caret placement must survive — the handler only covers the frame.
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not collapse the caret of an already-focused editor", () => {
    const { field, editor } = mount();
    // Drive real content through the editor's own input path so the component's
    // serialized text() matches the DOM, then park the caret mid-draft.
    editor.focus();
    editor.textContent = "hello world";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    setCaretAtOffset(editor, 5, []);
    expect(caretOffset(editor, [])).toBe(5);

    mousedown(field);

    // Clicking the frame while editing must leave the caret where it was, not
    // jump it to the end of the draft.
    expect(caretOffset(editor, [])).toBe(5);
  });

  it("ignores non-primary buttons so the context menu and middle-click paste work", () => {
    const { field, editor } = mount();

    const right = mousedown(field, 2);
    expect(right.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(editor);

    const middle = mousedown(field, 1);
    expect(middle.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(editor);
  });
});
