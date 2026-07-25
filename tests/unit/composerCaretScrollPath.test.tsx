// @vitest-environment jsdom
//
// Regression coverage for #352's caret half: a scripted caret placement does not
// scroll the caret into view the way typing does, and the editor is capped at
// 200px — so past that cap a Shift+Enter left the caret, and everything typed
// after it, below the fold.
//
// `composerCaretScroll.test.ts` pins the pure math. That leaves the production
// call path unprotected: deleting `scrollCaretIntoView(field)` from
// `Composer.placeCaret` keeps every one of those assertions green. This mounts
// the real Composer, gives jsdom the layout geometry it has none of, and drives
// a real Shift+Enter.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../src/components/chat/ImageLightbox", () => ({ openLightbox: () => {} }));

// Same seams the sibling composer test stubs: mount-time CLI/skill discovery
// and clipboard IPC, neither of which is under test here.
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

const EDITOR_TOP = 100;
const EDITOR_HEIGHT = 200; // the .pf-chat-textarea max-height cap
const CONTENT_HEIGHT = 600; // a draft well past the cap

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
const restoreProps: Array<[string, PropertyDescriptor | undefined]> = [];
let scrollTops = new WeakMap<Element, number>();
// Where the caret reports itself, in client coordinates.
let caretBottom = EDITOR_TOP + 50;

function defineProp(name: string, descriptor: PropertyDescriptor): void {
  restoreProps.push([name, Object.getOwnPropertyDescriptor(Element.prototype, name)]);
  Object.defineProperty(Element.prototype, name, { configurable: true, ...descriptor });
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  scrollTops = new WeakMap();
  caretBottom = EDITOR_TOP + 50;

  defineProp("scrollTop", {
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      scrollTops.set(this, value);
    },
  });
  defineProp("clientHeight", {
    get(this: Element) {
      return this.classList.contains("pf-chat-editor") ? EDITOR_HEIGHT : 0;
    },
  });
  defineProp("scrollHeight", {
    get(this: Element) {
      return this.classList.contains("pf-chat-editor") ? CONTENT_HEIGHT : 0;
    },
  });
  defineProp("getBoundingClientRect", {
    value(this: Element) {
      const height = this.classList.contains("pf-chat-editor") ? EDITOR_HEIGHT : 0;
      return {
        top: EDITOR_TOP,
        bottom: EDITOR_TOP + height,
        left: 0,
        right: 0,
        width: 0,
        height,
        x: 0,
        y: 0,
      } as DOMRect;
    },
  });
  // jsdom's Range has no geometry at all; the helper falls back to the caret's
  // neighbouring node, so give every element the caret's reported position.
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [] as unknown as DOMRectList;
    },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  for (const [name, descriptor] of restoreProps.reverse()) {
    if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
    else delete (Element.prototype as unknown as Record<string, unknown>)[name];
  }
  restoreProps.length = 0;
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects;
  vi.clearAllMocks();
});

function mountComposer(): HTMLElement {
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
      />
    ),
    root,
  );
  const editor = root.querySelector<HTMLElement>(".pf-chat-editor");
  if (!editor) throw new Error("composer did not mount");
  return editor;
}

function shiftEnter(editor: HTMLElement): void {
  editor.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
  );
}

describe("composer caret stays in view after a programmatic edit (#352)", () => {
  it("scrolls the editor when Shift+Enter puts the caret below the fold", () => {
    const editor = mountComposer();
    editor.focus();
    // The caret's line sits past the bottom of the 200px window.
    caretBottom = EDITOR_TOP + EDITOR_HEIGHT + 40;
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Element) {
        const isEditor = this.classList.contains("pf-chat-editor");
        const top = isEditor ? EDITOR_TOP : caretBottom - 20;
        const bottom = isEditor ? EDITOR_TOP + EDITOR_HEIGHT : caretBottom;
        return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: 0 } as DOMRect;
      },
    });

    expect(editor.scrollTop).toBe(0);
    shiftEnter(editor);

    // 40px past the window plus the helper's 4px pad.
    expect(editor.scrollTop).toBe(44);
  });

  it("leaves the scroll position alone when the caret is already visible", () => {
    const editor = mountComposer();
    editor.focus();

    shiftEnter(editor);

    expect(editor.scrollTop).toBe(0);
  });
});
