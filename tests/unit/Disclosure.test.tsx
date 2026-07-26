// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Disclosure } from "../../src/components/ui";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

// jsdom reports an empty transitionDuration, which would make every unmount
// instant and hide the delay this component exists for. Stub it so the timing
// contract is actually exercised.
function stubTransitionDuration(value: string) {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element) => {
    const style = real(el as HTMLElement);
    return new Proxy(style, {
      get: (target, key) =>
        key === "transitionDuration" ? value : Reflect.get(target, key),
    });
  }) as typeof window.getComputedStyle);
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  vi.useFakeTimers();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function body() {
  return root.querySelector("[data-body]");
}

describe("Disclosure", () => {
  it("keeps the body out of the DOM while closed", () => {
    stubTransitionDuration("180ms");
    dispose = render(() => <Disclosure open={false}><span data-body /></Disclosure>, root);

    expect(body()).toBeNull();
    expect(root.querySelector(".pf-collapse--closed")).not.toBeNull();
  });

  it("mounts the body immediately on open", () => {
    stubTransitionDuration("180ms");
    const [open, setOpen] = createSignal(false);
    dispose = render(() => <Disclosure open={open()}><span data-body /></Disclosure>, root);

    setOpen(true);
    expect(body()).not.toBeNull();
    expect(root.querySelector(".pf-collapse--closed")).toBeNull();
  });

  it("holds the body mounted until the collapse has played, then drops it", () => {
    stubTransitionDuration("180ms");
    const [open, setOpen] = createSignal(true);
    dispose = render(() => <Disclosure open={open()}><span data-body /></Disclosure>, root);
    expect(body()).not.toBeNull();

    setOpen(false);
    // Still mounted: unmounting here would make the row vanish instead of
    // collapsing, which is the snap this component exists to remove.
    expect(body()).not.toBeNull();
    expect(root.querySelector(".pf-collapse--closed")).not.toBeNull();

    vi.advanceTimersByTime(179);
    expect(body()).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(body()).toBeNull();
  });

  it("drops the body on the next tick under reduced motion, without waiting on a transition that never fires", () => {
    // `prefers-reduced-motion` collapses --pf-dur-* to 0ms, so no transitionend
    // is ever emitted. Reading the duration from computed style is what keeps
    // this from hanging the body in the DOM forever.
    stubTransitionDuration("0s");
    const [open, setOpen] = createSignal(true);
    dispose = render(() => <Disclosure open={open()}><span data-body /></Disclosure>, root);

    setOpen(false);
    vi.advanceTimersByTime(0);
    expect(body()).toBeNull();
  });

  it("cancels the pending unmount when reopened mid-collapse", () => {
    stubTransitionDuration("180ms");
    const [open, setOpen] = createSignal(true);
    dispose = render(() => <Disclosure open={open()}><span data-body /></Disclosure>, root);

    setOpen(false);
    vi.advanceTimersByTime(90);
    setOpen(true);
    // The scheduled unmount must not fire and yank the body out from under a
    // body that is now reopening.
    vi.advanceTimersByTime(200);

    expect(body()).not.toBeNull();
    expect(root.querySelector(".pf-collapse--closed")).toBeNull();
  });

  it("takes the longest duration when several are declared", () => {
    stubTransitionDuration("0.05s, 300ms");
    const [open, setOpen] = createSignal(true);
    dispose = render(() => <Disclosure open={open()}><span data-body /></Disclosure>, root);

    setOpen(false);
    vi.advanceTimersByTime(299);
    expect(body()).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(body()).toBeNull();
  });
});
