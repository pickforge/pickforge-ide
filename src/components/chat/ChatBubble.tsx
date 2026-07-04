import { type JSX, For, Show, createEffect } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { embedImageMarkers, renderMarkdown } from "../../lib/markdown";
import { openLightbox } from "./ImageLightbox";
import "./chat.css";

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
  const thumb = target?.closest<HTMLElement>("[data-pf-image-index]");
  if (!thumb || !images) return;
  const idx = Number(thumb.dataset.pfImageIndex);
  if (Number.isInteger(idx) && idx >= 0 && idx < images.length) {
    openLightbox(convertFileSrc(images[idx]));
  }
}

export function ChatBubble(props: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  images?: string[];
}): JSX.Element {
  let mdEl: HTMLDivElement | undefined;

  const body = () => {
    if (props.role === "user" && props.images && props.images.length > 0) {
      return renderMarkdown(embedImageMarkers(props.text, props.images.length));
    }
    return renderMarkdown(props.text);
  };

  // The sanitized markdown never carries an asset path — only a zero-based
  // index. Hydrate the real src onto each inline thumbnail after the DOM
  // updates, keeping DOMPurify's default URI policy untouched.
  createEffect(() => {
    body();
    const images = props.images;
    queueMicrotask(() => {
      const el = mdEl;
      if (!el || !images) return;
      el
        .querySelectorAll<HTMLImageElement>("img[data-pf-image-index]")
        .forEach((img) => {
          const idx = Number(img.dataset.pfImageIndex);
          if (Number.isInteger(idx) && idx >= 0 && idx < images.length) {
            img.src = convertFileSrc(images[idx]);
          }
        });
    });
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
        <Show when={props.images && props.images.length > 0}>
          <div class="pf-chat-bubble-images">
            <For each={props.images}>
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
