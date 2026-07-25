import { type JSX, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  embedImageMarkers,
  referencedImageIndexes,
  renderMarkdown,
} from "../../lib/markdown";
import { classifyChatLink, type ChatLinkTarget } from "../../lib/chatLinkTarget";
import { resolveWorkspaceCitation } from "../../lib/chatLinkResolve";
import { openExternalUrl } from "../../lib/opener";
import { openFileInChat } from "../../stores/terminalHosts";
import { remotePtyFor } from "../../lib/remoteContext";
import { openLightbox } from "./ImageLightbox";
import "./chat.css";

const STREAM_MARKDOWN_INTERVAL_MS = 80;
const LINK_NOTICE_MS = 4000;

interface ChatLinkContext {
  chatId?: string;
  projectRoot?: string;
  streaming?: boolean;
  notify: (message: string) => void;
}

/** The raw href a Markdown anchor was rendered from (`markdown.ts`'s link
 *  renderer carries it as `data-pf-chat-link` for every non-https target,
 *  falling back to the real `href` for an approved https link). Re-read at
 *  click time (never cached from render) so classification always reflects
 *  the DOM as it exists right now. */
function chatLinkHrefFrom(anchor: HTMLAnchorElement): string {
  return anchor.dataset.pfChatLink ?? anchor.getAttribute("href") ?? "";
}

/** Route a classified chat-link target to its one safe application intent
 *  (#234): approved `https://` opens in the system browser, a workspace
 *  citation resolves at the Rust trust boundary — scoped to the chat's own
 *  project root, never falling back to a local path for a remote chat —
 *  before opening, and everything else stays inert with concise feedback
 *  that never leaks the rejected path. */
async function routeChatLink(target: ChatLinkTarget, ctx: ChatLinkContext): Promise<void> {
  if (target.kind === "externalHttps") {
    try {
      await openExternalUrl(target.url);
    } catch (e) {
      console.error("[pickforge] open_external_url failed", e);
    }
    return;
  }
  if (target.kind === "blocked") {
    ctx.notify("This link can't be opened.");
    return;
  }
  // workspaceCitation
  if (!ctx.projectRoot) {
    ctx.notify("This link can't be opened.");
    return;
  }
  if (remotePtyFor(ctx.projectRoot)) {
    ctx.notify("Citations aren't supported in remote chats yet.");
    return;
  }
  try {
    const resolved = await resolveWorkspaceCitation(ctx.projectRoot, target.path);
    openFileInChat(ctx.chatId, resolved, ctx.projectRoot, {
      line: target.line,
      column: target.column,
      endLine: target.endLine,
    });
  } catch {
    ctx.notify("This link can't be opened.");
  }
}

function activateChatLink(anchor: HTMLAnchorElement, ctx: ChatLinkContext): void {
  // Inert while the message is still streaming — the target text (and thus
  // its classification) can change out from under a click mid-update.
  if (ctx.streaming) return;
  const target = classifyChatLink(chatLinkHrefFrom(anchor));
  void routeChatLink(target, ctx);
}

// A plain <a href> click would navigate the whole webview away from the app,
// so every anchor click is ALWAYS cancelled first — including a modifier
// (Ctrl/Cmd) click, which still fires as a normal `click` event — before the
// classified target is routed to its one safe intent. Clicks on an inline
// `[Image #N]` thumbnail open the lightbox for the corresponding attachment.
function onMarkdownClick(e: MouseEvent, images: string[] | undefined, ctx: ChatLinkContext): void {
  const target = e.target as HTMLElement | null;
  const anchor = target?.closest("a");
  if (anchor) {
    e.preventDefault();
    activateChatLink(anchor, ctx);
    return;
  }
  openThumbTarget(target, images);
}

// A middle click on an anchor fires `auxclick`, not `click` — the browser's
// default "open in a new tab" action must be cancelled here too, or the
// webview would navigate before any `click` handler ever ran.
function onMarkdownAuxClick(e: MouseEvent, ctx: ChatLinkContext): void {
  if (e.button !== 1) return;
  const target = e.target as HTMLElement | null;
  const anchor = target?.closest("a");
  if (!anchor) return;
  e.preventDefault();
  activateChatLink(anchor, ctx);
}

// Inline thumbnails hydrate as focusable button-role images — Enter/Space must
// open the lightbox just like a click. A normal `<a href>` is already
// keyboard-activatable (Tab + Enter fires a native `click`), so anchors need
// no handling here.
function onMarkdownKeyDown(e: KeyboardEvent, images?: string[]): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = e.target as HTMLElement | null;
  if (!target?.closest("[data-pf-image-index]")) return;
  e.preventDefault();
  openThumbTarget(target, images);
}

function openThumbTarget(target: HTMLElement | null, images?: string[]): void {
  const thumb = target?.closest<HTMLElement>("[data-pf-image-index]");
  if (!thumb || !images) return;
  const idx = Number(thumb.dataset.pfImageIndex);
  if (Number.isInteger(idx) && idx >= 0 && idx < images.length) {
    openLightbox(convertFileSrc(images[idx]));
  }
}

export function renderChatMarkdown(
  role: "user" | "assistant",
  text: string,
  images: string[] | undefined,
  streaming = false,
): string {
  const source =
    role === "user" && images && images.length > 0
      ? embedImageMarkers(text, images.length)
      : text;
  return renderMarkdown(source, { cache: !streaming });
}

/** Throttles `text()` updates while `streaming()` is true, so a fast token
 * stream re-renders markdown at most once per `intervalMs` instead of on
 * every delta — flushing immediately once streaming stops. A composable,
 * called synchronously from the caller's setup so its `createEffect`/
 * `onCleanup` run under the same reactive owner as if written inline. */
function createThrottledText(
  text: () => string,
  streaming: () => boolean | undefined,
  intervalMs: number,
): () => string {
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRenderAt = 0;
  let pendingText = text();
  const [renderText, setRenderText] = createSignal(pendingText);

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const flush = () => {
    renderTimer = undefined;
    lastRenderAt = now();
    setRenderText(pendingText);
  };

  createEffect(() => {
    pendingText = text();
    if (!streaming()) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      flush();
      return;
    }

    const delay = Math.max(0, intervalMs - (now() - lastRenderAt));
    if (delay === 0) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      flush();
      return;
    }
    if (!renderTimer) renderTimer = setTimeout(flush, delay);
  });

  onCleanup(() => {
    if (renderTimer) clearTimeout(renderTimer);
  });

  return renderText;
}

/** Concise, accessible feedback for a blocked/unsupported chat-link click —
 *  never the rejected path itself. Auto-clears after `ms` so a stale notice
 *  doesn't linger. A composable (same pattern as `createThrottledText`),
 *  called synchronously from the caller's setup so its `onCleanup` runs
 *  under the same reactive owner as if written inline. */
function createLinkNotice(ms: number): {
  notice: () => string | null;
  notify: (message: string) => void;
} {
  const [notice, setNotice] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = (message: string) => {
    setNotice(message);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setNotice(null), ms);
  };
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });
  return { notice, notify };
}

/** Hydrates each inline `[Image #N]` thumbnail's real `src` (and keyboard/
 *  button semantics) onto the sanitized markdown after it renders — the
 *  sanitized HTML never carries an asset path, only a zero-based index, so
 *  DOMPurify's default URI policy stays untouched. A composable (same
 *  pattern as `createThrottledText`), called synchronously from the
 *  caller's setup so its `createEffect` runs under the same reactive owner
 *  as if written inline. */
function hydrateInlineImageThumbnails(
  el: () => HTMLDivElement | undefined,
  images: () => string[] | undefined,
  body: () => string,
): void {
  createEffect(() => {
    const list = images();
    if (!list || list.length === 0) return;
    body();
    queueMicrotask(() => {
      const node = el();
      if (!node || !list) return;
      node
        .querySelectorAll<HTMLImageElement>("img[data-pf-image-index]")
        .forEach((img) => {
          const idx = Number(img.dataset.pfImageIndex);
          if (Number.isInteger(idx) && idx >= 0 && idx < list.length) {
            img.src = convertFileSrc(list[idx]);
            img.loading = "lazy";
            img.decoding = "async";
            img.tabIndex = 0;
            img.setAttribute("role", "button");
            img.setAttribute("aria-label", "View image");
          }
        });
    });
  });
}

export function ChatBubble(props: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  images?: string[];
  chatId?: string;
  projectRoot?: string;
}): JSX.Element {
  let mdEl: HTMLDivElement | undefined;
  const renderText = createThrottledText(
    () => props.text,
    () => props.streaming,
    STREAM_MARKDOWN_INTERVAL_MS,
  );

  const { notice: linkNotice, notify: notifyLink } = createLinkNotice(LINK_NOTICE_MS);
  const linkCtx = (): ChatLinkContext => ({
    chatId: props.chatId,
    projectRoot: props.projectRoot,
    streaming: props.streaming,
    notify: notifyLink,
  });

  const body = createMemo(() => {
    return renderChatMarkdown(props.role, renderText(), props.images, props.streaming);
  });

  hydrateInlineImageThumbnails(() => mdEl, () => props.images, body);

  // Marker-referenced attachments render inline within the text — repeating
  // them in the strip above would show the same image twice.
  const stripImages = createMemo(() => {
    const images = props.images ?? [];
    if (props.role !== "user" || images.length === 0) return images;
    const referenced = referencedImageIndexes(props.text, images.length);
    return images.filter((_, i) => !referenced.has(i));
  });

  return (
    <div
      class="pf-chat-bubble-row"
      classList={{
        "pf-chat-bubble-row--user": props.role === "user",
        "pf-chat-bubble-row--assistant": props.role === "assistant",
      }}
    >
      <div
        class="pf-chat-bubble"
        classList={{
          "pf-chat-bubble--user": props.role === "user",
          "pf-chat-bubble--assistant": props.role === "assistant",
        }}
      >
        <Show when={stripImages().length > 0}>
          <div class="pf-chat-bubble-images">
            <For each={stripImages()}>
              {(path) => (
                <button
                  type="button"
                  class="pf-chat-bubble-img-btn"
                  aria-label="View image"
                  onClick={() => openLightbox(convertFileSrc(path))}
                >
                  <img
                    class="pf-chat-bubble-img"
                    src={convertFileSrc(path)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.text.length > 0}>
          <div
            ref={mdEl}
            class="pf-chat-md"
            onClick={(e) => onMarkdownClick(e, props.images, linkCtx())}
            onAuxClick={(e) => onMarkdownAuxClick(e, linkCtx())}
            onKeyDown={(e) => onMarkdownKeyDown(e, props.images)}
            innerHTML={body()}
          />
        </Show>
        <Show when={props.streaming}>
          <span class="pf-chat-caret" aria-hidden="true" />
        </Show>
        <Show when={linkNotice()}>
          <div class="pf-chat-link-notice" role="status" aria-live="polite">
            {linkNotice()}
          </div>
        </Show>
      </div>
    </div>
  );
}
