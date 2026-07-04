// A single full-viewport image viewer shared across the app. Any bubble or
// composer can call `openLightbox(src)`; a single mounted `<ImageLightbox />`
// renders the overlay. Because several chat lanes each mount an ImageLightbox
// (OrchestraView), an owner guard keeps exactly one instance rendering the
// portal at a time.
import { type JSX, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose } from "../icons";
import "./chat.css";

const [lightboxSrc, setLightboxSrc] = createSignal<string | null>(null);

export function openLightbox(src: string): void {
  setLightboxSrc(src);
}

function closeLightbox(): void {
  setLightboxSrc(null);
}

// One owner renders the overlay even when many ImageLightbox instances are
// mounted; ownership hands off if the current owner unmounts.
let nextId = 0;
const mounted = new Set<number>();
const [owner, setOwner] = createSignal<number | null>(null);

function claimOwnership(id: number): void {
  mounted.add(id);
  if (owner() === null) setOwner(id);
}

function releaseOwnership(id: number): void {
  mounted.delete(id);
  if (owner() === id) {
    const next = mounted.values().next();
    setOwner(next.done ? null : next.value);
    // Nobody left to render the overlay — drop the open image too, or the
    // next mount would resurrect a viewer the user already navigated away
    // from.
    if (next.done) setLightboxSrc(null);
  }
}

export function ImageLightbox(): JSX.Element {
  const id = nextId++;
  onMount(() => claimOwnership(id));
  onCleanup(() => releaseOwnership(id));

  const isOwner = () => owner() === id;
  const src = () => (isOwner() ? lightboxSrc() : null);

  let closeBtn: HTMLButtonElement | undefined;
  let restoreFocus: HTMLElement | null = null;

  createEffect(() => {
    if (!src()) return;
    restoreFocus = (document.activeElement as HTMLElement | null) ?? null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeLightbox();
      }
    };
    window.addEventListener("keydown", onKey, true);
    queueMicrotask(() => closeBtn?.focus());
    onCleanup(() => {
      window.removeEventListener("keydown", onKey, true);
      restoreFocus?.focus?.();
      restoreFocus = null;
    });
  });

  return (
    <Show when={src()}>
      {(current) => (
        <Portal>
          <div
            class="pf-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Image viewer"
            onClick={closeLightbox}
          >
            <button
              ref={closeBtn}
              type="button"
              class="pf-lightbox-close"
              aria-label="Close image"
              onClick={(e) => {
                e.stopPropagation();
                closeLightbox();
              }}
            >
              <IconClose size={18} />
            </button>
            <img
              class="pf-lightbox-img"
              src={current()}
              alt=""
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </Portal>
      )}
    </Show>
  );
}
