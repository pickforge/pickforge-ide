import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import {
  endTour,
  TOUR_STEPS,
  tourActive,
  tourNext,
  tourPrev,
  tourStep,
} from "../stores/tour";
import "./tour.css";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 320;
const GAP = 14;

// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function Tour() {
  const [rect, setRect] = createSignal<Rect | null>(null);
  const step = () => TOUR_STEPS[tourStep()];

  const measure = () => {
    const target = step()?.target;
    if (!target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setRect(null);
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  };

  createEffect(() => {
    if (!tourActive()) return;
    tourStep();
    measure();
    const onShift = () => measure();
    window.addEventListener("resize", onShift, true);
    window.addEventListener("scroll", onShift, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endTour();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        tourNext();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        tourPrev();
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      window.removeEventListener("resize", onShift, true);
      window.removeEventListener("scroll", onShift, true);
      window.removeEventListener("keydown", onKey, true);
    });
  });

  const spotlight = () => {
    const r = rect();
    if (!r) return null;
    return {
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    };
  };

  const cardPos = (): { top: number; left: number } => {
    const s = spotlight();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!s) {
      return { top: Math.max(GAP, vh / 2 - 90), left: Math.max(GAP, vw / 2 - CARD_W / 2) };
    }
    let left = s.left + s.width / 2 - CARD_W / 2;
    left = Math.max(GAP, Math.min(left, vw - CARD_W - GAP));
    const below = s.top + s.height + GAP;
    let top = below;
    if (below + 170 > vh) {
      top = Math.max(GAP, s.top - 170 - GAP);
    }
    return { top, left };
  };

  const isLast = () => tourStep() >= TOUR_STEPS.length - 1;

  return (
    <Show when={tourActive()}>
      <Portal>
        <div class="pf-tour" role="dialog" aria-modal="true">
          <Show
            when={spotlight()}
            fallback={<div class="pf-tour-scrim" onClick={() => endTour()} />}
          >
            {(s) => (
              <div class="pf-tour-scrim pf-tour-scrim--spot" onClick={() => endTour()}>
                <div
                  class="pf-tour-ring"
                  style={{
                    top: `${s().top}px`,
                    left: `${s().left}px`,
                    width: `${s().width}px`,
                    height: `${s().height}px`,
                  }}
                />
              </div>
            )}
          </Show>

          <div
            class="pf-tour-card"
            style={{ top: `${cardPos().top}px`, left: `${cardPos().left}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="pf-tour-eyebrow">
              Tour · {tourStep() + 1}/{TOUR_STEPS.length}
            </div>
            <div class="pf-tour-title">{step()?.title}</div>
            <p class="pf-tour-body">{step()?.body}</p>
            <div class="pf-tour-dots">
              <For each={TOUR_STEPS}>
                {(_, i) => (
                  <span
                    class="pf-tour-dot"
                    classList={{ "pf-tour-dot--on": i() === tourStep() }}
                  />
                )}
              </For>
            </div>
            <div class="pf-tour-actions">
              <button class="pf-tour-skip" onClick={() => endTour()}>
                Skip
              </button>
              <div class="pf-tour-nav">
                <Show when={tourStep() > 0}>
                  <button class="pf-tour-back" onClick={() => tourPrev()}>
                    Back
                  </button>
                </Show>
                <button class="pf-tour-next" onClick={() => tourNext()}>
                  {isLast() ? "Done" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
