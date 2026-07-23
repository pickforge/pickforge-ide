import { type JSX, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  embedImageMarkers,
  referencedImageIndexes,
  renderMarkdown,
} from "../../lib/markdown";
import { openLightbox } from "./ImageLightbox";
import "./chat.css";

const STREAM_MARKDOWN_INTERVAL_MS = 80;

// A plain <a href> click would navigate the whole webview away from the app.
// No URL-safe opener exists (open_path canonicalizes against approved roots and
// rejects URLs; no opener/shell plugin is wired), so anchor clicks are cancelled
// rather than routed externally. Clicks on an inline `[Image #N]` thumbnail open
// the lightbox for the corresponding attachment.
function onMarkdownClick(e: MouseEvent, images?: string[]): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest("a")) {
    e.preventDefault();
    return;
  }
  openThumbTarget(target, images);
}

// Inline thumbnails hydrate as focusable button-role images — Enter/Space must
// open the lightbox just like a click.
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

// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function ChatBubble(props: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  images?: string[];
}): JSX.Element {
  let mdEl: HTMLDivElement | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRenderAt = 0;
  let pendingRenderText = props.text;
  const [renderText, setRenderText] = createSignal(props.text);

  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const flushRenderText = () => {
    renderTimer = undefined;
    lastRenderAt = now();
    setRenderText(pendingRenderText);
  };

  createEffect(() => {
    pendingRenderText = props.text;
    if (!props.streaming) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      flushRenderText();
      return;
    }

    const delay = Math.max(0, STREAM_MARKDOWN_INTERVAL_MS - (now() - lastRenderAt));
    if (delay === 0) {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      flushRenderText();
      return;
    }
    if (!renderTimer) renderTimer = setTimeout(flushRenderText, delay);
  });

  onCleanup(() => {
    if (renderTimer) clearTimeout(renderTimer);
  });

  const body = createMemo(() => {
    return renderChatMarkdown(props.role, renderText(), props.images, props.streaming);
  });

  // The sanitized markdown never carries an asset path — only a zero-based
  // index. Hydrate the real src (and button semantics for keyboard users) onto
  // each inline thumbnail after the DOM updates, keeping DOMPurify's default
  // URI policy untouched.
  createEffect(() => {
    const images = props.images;
    if (!images || images.length === 0) return;
    body();
    queueMicrotask(() => {
      const el = mdEl;
      if (!el || !images) return;
      el
        .querySelectorAll<HTMLImageElement>("img[data-pf-image-index]")
        .forEach((img) => {
          const idx = Number(img.dataset.pfImageIndex);
          if (Number.isInteger(idx) && idx >= 0 && idx < images.length) {
            img.src = convertFileSrc(images[idx]);
            img.loading = "lazy";
            img.decoding = "async";
            img.tabIndex = 0;
            img.setAttribute("role", "button");
            img.setAttribute("aria-label", "View image");
          }
        });
    });
  });

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
            onClick={(e) => onMarkdownClick(e, props.images)}
            onKeyDown={(e) => onMarkdownKeyDown(e, props.images)}
            innerHTML={body()}
          />
        </Show>
        <Show when={props.streaming}>
          <span class="pf-chat-caret" aria-hidden="true" />
        </Show>
      </div>
    </div>
  );
}
