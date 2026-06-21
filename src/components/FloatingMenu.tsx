// A popover menu rendered in a Portal at the document root, positioned with
// fixed coordinates and clamped to the viewport — so it floats above every
// pane/dock regardless of the overflow/stacking of whatever opened it. Used by
// the three-dots buttons and right-click context menus across the rail.
import { Portal } from "solid-js/web";
import { onCleanup, onMount, type JSX } from "solid-js";

export interface MenuAnchor {
  x: number;
  y: number;
  /** Which edge of the menu the x coordinate pins to. */
  align?: "start" | "end";
}

const GAP = 6;

export function FloatingMenu(props: {
  anchor: MenuAnchor;
  onClose: () => void;
  children: JSX.Element;
}) {
  let el!: HTMLDivElement;

  const place = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    let x = props.anchor.align === "end" ? props.anchor.x - r.width : props.anchor.x;
    let y = props.anchor.y;
    if (x + r.width > vw - GAP) x = vw - r.width - GAP;
    if (x < GAP) x = GAP;
    if (y + r.height > vh - GAP) y = Math.max(GAP, props.anchor.y - r.height);
    if (y < GAP) y = GAP;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.visibility = "visible";
  };

  onMount(() => {
    place();
    // Re-clamp when the menu's own size changes (e.g. revealing a taller form),
    // so growing content can't push controls below the viewport edge.
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) props.onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, true);
    window.addEventListener("resize", props.onClose);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("resize", props.onClose);
    });
  });

  return (
    <Portal>
      <div
        ref={el}
        class="pf-menu pf-floating-menu"
        style={{ visibility: "hidden" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </Portal>
  );
}
