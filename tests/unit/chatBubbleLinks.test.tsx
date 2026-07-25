// @vitest-environment jsdom
//
// Contract tests for #234's chat-link click routing at the ChatBubble seam:
// classify the clicked anchor's href, then route to exactly one safe intent
// (approved https open, a Rust-resolved workspace citation, or inert). The
// pure classifier itself is exhaustively tested in chatLinkTarget.test.ts;
// these tests prove ChatBubble wires it up correctly — preventDefault always
// fires, streaming makes every link inert, a remote-bound project never
// falls back to a local path, and a resolver rejection surfaces as generic
// feedback rather than a silent no-op.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/components/chat/ImageLightbox", () => ({ openLightbox: vi.fn() }));

const opener = vi.hoisted(() => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock("../../src/lib/opener", () => ({ openExternalUrl: opener.openExternalUrl }));

const terminalHosts = vi.hoisted(() => ({ openFileInChat: vi.fn() }));
vi.mock("../../src/stores/terminalHosts", () => ({
  openFileInChat: terminalHosts.openFileInChat,
}));

const remoteContext = vi.hoisted(() => ({ remotePtyFor: vi.fn(() => null as unknown) }));
vi.mock("../../src/lib/remoteContext", () => ({ remotePtyFor: remoteContext.remotePtyFor }));

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { ChatBubble } from "../../src/components/chat/ChatBubble";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  opener.openExternalUrl.mockClear();
  terminalHosts.openFileInChat.mockClear();
  remoteContext.remotePtyFor.mockClear();
  remoteContext.remotePtyFor.mockReturnValue(null);
  tauri.invoke.mockReset();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function mount(props: {
  text: string;
  streaming?: boolean;
  chatId?: string;
  projectRoot?: string;
}) {
  dispose = render(
    () => (
      <ChatBubble
        role="assistant"
        text={props.text}
        streaming={props.streaming}
        chatId={props.chatId}
        projectRoot={props.projectRoot}
      />
    ),
    root,
  );
  return root.querySelector<HTMLAnchorElement>(".pf-chat-md a")!;
}

// jsdom fires a real `click` event but doesn't itself navigate on an
// unprevented anchor, so this only proves OUR handler called preventDefault.
function click(anchor: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  return event;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ChatBubble chat-link routing: external https", () => {
  it("opens an approved https link via the external opener and always prevents default", async () => {
    const anchor = mount({ text: "[docs](https://example.com/a)" });

    const event = click(anchor);
    expect(event.defaultPrevented).toBe(true);
    await flush();

    expect(opener.openExternalUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/a");
    expect(terminalHosts.openFileInChat).not.toHaveBeenCalled();
  });
});

describe("ChatBubble chat-link routing: workspace citation", () => {
  it("resolves through the Rust trust boundary and opens the file at its location", async () => {
    tauri.invoke.mockResolvedValue("/proj/src/a.ts");
    const anchor = mount({
      text: "[a](src/a.ts#L12C4)",
      chatId: "chat-1",
      projectRoot: "/proj",
    });

    click(anchor);
    await flush();

    expect(tauri.invoke).toHaveBeenCalledExactlyOnceWith("resolve_chat_citation", {
      projectRoot: "/proj",
      path: "src/a.ts",
    });
    expect(terminalHosts.openFileInChat).toHaveBeenCalledExactlyOnceWith(
      "chat-1",
      "/proj/src/a.ts",
      "/proj",
      { line: 12, column: 4, endLine: undefined },
    );
  });

  it("never falls back to a local path for a remote-bound project — visibly unsupported instead", async () => {
    remoteContext.remotePtyFor.mockReturnValue({ host: "mac-mini", remoteRoot: "/srv/app" });
    const anchor = mount({
      text: "[a](src/a.ts#L1)",
      chatId: "chat-1",
      projectRoot: "/proj",
    });

    click(anchor);
    await flush();

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(terminalHosts.openFileInChat).not.toHaveBeenCalled();
    expect(root.querySelector(".pf-chat-link-notice")?.textContent).toMatch(/remote/i);
  });

  it("shows generic feedback (never the rejected path) when resolution is rejected", async () => {
    tauri.invoke.mockRejectedValue(new Error("citation path is not an existing file"));
    const anchor = mount({
      text: "[a](../../etc/passwd#L1)",
      chatId: "chat-1",
      projectRoot: "/proj",
    });

    click(anchor);
    await flush();

    expect(terminalHosts.openFileInChat).not.toHaveBeenCalled();
    const notice = root.querySelector(".pf-chat-link-notice")?.textContent ?? "";
    expect(notice.length).toBeGreaterThan(0);
    expect(notice).not.toContain("passwd");
  });

  it("stays inert with no projectRoot to resolve against", async () => {
    const anchor = mount({ text: "[a](src/a.ts#L1)" });

    click(anchor);
    await flush();

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(terminalHosts.openFileInChat).not.toHaveBeenCalled();
  });
});

describe("ChatBubble chat-link routing: inert states", () => {
  it("blocks a non-https scheme with no IPC call at all", async () => {
    const anchor = mount({ text: "[x](javascript:alert(1))", projectRoot: "/proj" });

    const event = click(anchor);
    expect(event.defaultPrevented).toBe(true);
    await flush();

    expect(opener.openExternalUrl).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(terminalHosts.openFileInChat).not.toHaveBeenCalled();
  });

  it("is inert while the message is still streaming, even for an otherwise-valid citation", async () => {
    const anchor = mount({
      text: "[a](src/a.ts#L1)",
      streaming: true,
      chatId: "chat-1",
      projectRoot: "/proj",
    });

    const event = click(anchor);
    expect(event.defaultPrevented).toBe(true);
    await flush();

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(terminalHosts.openFileInChat).not.toHaveBeenCalled();
    expect(root.querySelector(".pf-chat-link-notice")).toBeNull();
  });

  it("prevents default on a middle-click (auxclick) the same as a primary click", async () => {
    tauri.invoke.mockResolvedValue("/proj/src/a.ts");
    const anchor = mount({ text: "[a](src/a.ts)", chatId: "chat-1", projectRoot: "/proj" });

    const event = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flush();

    expect(terminalHosts.openFileInChat).toHaveBeenCalledExactlyOnceWith(
      "chat-1",
      "/proj/src/a.ts",
      "/proj",
      { line: undefined, column: undefined, endLine: undefined },
    );
  });
});
